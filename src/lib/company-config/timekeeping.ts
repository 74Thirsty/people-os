import type { CompanyConfig } from "./schema";

function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
}

function diffDays(later: string, earlier: string): number {
  return Math.round((parseDateOnly(later).getTime() - parseDateOnly(earlier).getTime()) / 86_400_000);
}

export interface PayPeriod {
  key: string;
  start: string;
  end: string;
  cutoffDate: string;
  frequency: CompanyConfig["hr"]["timekeeping"]["payPeriods"]["frequency"];
  anchorDate: string;
  timezone: string;
}

/** Resolve the configured pay period containing an ISO date. */
export function resolvePayPeriod(config: CompanyConfig, dateOnly: string): PayPeriod {
  const { frequency, anchorDate, cutoffDaysBeforeEnd, timezone } = config.hr.timekeeping.payPeriods;
  let start: string;
  let end: string;

  if (frequency === "weekly" || frequency === "biweekly") {
    const length = frequency === "weekly" ? 7 : 14;
    const offset = diffDays(dateOnly, anchorDate);
    const index = Math.floor(offset / length);
    start = addDays(anchorDate, index * length);
    end = addDays(start, length - 1);
  } else if (frequency === "semimonthly") {
    const [year, month, day] = dateOnly.split("-").map(Number);
    if (day <= 15) {
      start = `${year}-${String(month).padStart(2, "0")}-01`;
      end = `${year}-${String(month).padStart(2, "0")}-15`;
    } else {
      start = `${year}-${String(month).padStart(2, "0")}-16`;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    }
  } else {
    const [year, month] = dateOnly.split("-").map(Number);
    start = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

  return {
    key: `${frequency}:${start}:${end}`,
    start,
    end,
    cutoffDate: addDays(end, -cutoffDaysBeforeEnd),
    frequency,
    anchorDate,
    timezone
  };
}

export interface ShiftMinutes {
  rawMinutes: number;
  unpaidBreakMinutes: number;
  compensableMinutes: number;
  mealDeducted: boolean;
}

/** Compute compensable minutes using the configured unpaid meal rule. */
export function calculateShiftMinutes(
  config: CompanyConfig,
  input: { start: string; end: string; breakMinutes?: number }
): ShiftMinutes {
  const start = Date.parse(input.start);
  const end = Date.parse(input.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("Shift start and end must be valid timestamps");
  const rawMinutes = Math.round((end - start) / 60_000);
  if (rawMinutes <= 0) throw new Error("Shift end must be after shift start");

  const meal = config.hr.timekeeping.breaks.unpaidMeal;
  let unpaidBreakMinutes = input.breakMinutes ?? 0;
  let mealDeducted = false;
  if (input.breakMinutes === undefined && meal.autoDeduct && rawMinutes >= meal.triggerAfterMinutes) {
    unpaidBreakMinutes = meal.minimumMinutes;
    mealDeducted = true;
  }
  if (unpaidBreakMinutes > rawMinutes) throw new Error("Unpaid break exceeds shift duration");
  return {
    rawMinutes,
    unpaidBreakMinutes,
    compensableMinutes: rawMinutes - unpaidBreakMinutes,
    mealDeducted
  };
}

export interface OvertimeSplit {
  regularMinutes: number;
  overtimeMinutes: number;
  multiplier: number;
  weeklyThresholdMinutes: number;
}

/**
 * Split a shift using configured weekly (and optional daily) thresholds.
 * priorWeeklyMinutes must include all compensable minutes earlier in the workweek.
 */
export function calculateOvertime(
  config: CompanyConfig,
  input: { shiftMinutes: number; priorWeeklyMinutes: number; priorDailyMinutes?: number }
): OvertimeSplit {
  const rules = config.hr.timekeeping.overtime;
  if (!Number.isSafeInteger(input.shiftMinutes) || input.shiftMinutes < 0) {
    throw new Error("shiftMinutes must be a non-negative integer");
  }
  if (rules.treatment === "none") {
    return { regularMinutes: input.shiftMinutes, overtimeMinutes: 0, multiplier: 1, weeklyThresholdMinutes: rules.weeklyThresholdMinutes };
  }
  let remaining = input.shiftMinutes;
  let overtimeMinutes = 0;
  if (rules.dailyThresholdMinutes !== null && rules.treatment === "daily_and_weekly") {
    const priorDaily = input.priorDailyMinutes ?? 0;
    const dailyOvertime = Math.max(0, priorDaily + remaining - rules.dailyThresholdMinutes);
    overtimeMinutes += Math.min(remaining, dailyOvertime);
    remaining -= Math.min(remaining, dailyOvertime);
  }
  const weeklyOvertime = Math.max(0, input.priorWeeklyMinutes + remaining - rules.weeklyThresholdMinutes);
  overtimeMinutes += Math.min(remaining, weeklyOvertime);
  remaining -= Math.min(remaining, weeklyOvertime);
  return {
    regularMinutes: remaining,
    overtimeMinutes,
    multiplier: rules.multiplier,
    weeklyThresholdMinutes: rules.weeklyThresholdMinutes
  };
}

export function roundCompensableMinutes(config: CompanyConfig, minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < 0) throw new Error("minutes must be a non-negative integer");
  const rounding = config.hr.timekeeping.rounding;
  if (rounding.mode === "none") return minutes;
  const increment = rounding.incrementMinutes;
  return Math.round(minutes / increment) * increment;
}

export interface AttendanceEvaluation {
  lateMinutes: number;
  withinGrace: boolean;
  graceMinutes: number;
  policyId: string;
}

export function evaluateClockEvent(
  config: CompanyConfig,
  input: { scheduledAt: string; occurredAt: string; kind: "clock_in" | "clock_out" }
): AttendanceEvaluation {
  const scheduled = Date.parse(input.scheduledAt);
  const occurred = Date.parse(input.occurredAt);
  if (!Number.isFinite(scheduled) || !Number.isFinite(occurred)) throw new Error("Clock timestamps must be valid");
  const grace = config.hr.timekeeping.grace;
  const graceMinutes = input.kind === "clock_in" ? grace.clockInMinutes : grace.clockOutMinutes;
  const lateMinutes = Math.max(0, Math.round((occurred - scheduled) / 60_000) - graceMinutes);
  return {
    lateMinutes,
    withinGrace: lateMinutes === 0,
    graceMinutes,
    policyId: grace.policyId
  };
}

export interface CorrectionEvaluation {
  status: "pending_approval" | "outside_window" | "missing_evidence" | "eligible";
  ageDays: number;
  maxCorrectionDays: number;
  approvalAction: string;
}

export function evaluateTimeCorrection(
  config: CompanyConfig,
  input: { occurredAt: string; submittedAt: string; hasEvidence: boolean }
): CorrectionEvaluation {
  const rules = config.hr.timekeeping.missedPunch;
  const ageDays = diffDays(input.submittedAt.slice(0, 10), input.occurredAt.slice(0, 10));
  const base = { ageDays, maxCorrectionDays: rules.maxCorrectionDays, approvalAction: rules.approvalAction };
  if (ageDays < 0) throw new Error("Correction cannot be submitted before the event");
  if (ageDays > rules.maxCorrectionDays) return { ...base, status: "outside_window" };
  if (!input.hasEvidence) return { ...base, status: "missing_evidence" };
  return { ...base, status: rules.correctionRequiresApproval ? "pending_approval" : "eligible" };
}
