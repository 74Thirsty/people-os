/**
 * HRS is PeopleOS's proprietary, tenant-scoped hour accounting unit.
 * Quantities are stored as integer minutes to avoid floating-point drift.
 * HRS is not currency, a deposit, a security, or a transferable crypto-token.
 */

export type HrsEntryType =
  | "schedule_mint"
  | "work_consumption"
  | "schedule_release"
  | "correction";

export interface HrsLedgerEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly allocationId: string;
  readonly type: HrsEntryType;
  /** Positive integer minutes. Direction is represented by type, never sign. */
  readonly minutes: number;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly sourceReference: string;
}

export interface HrsAllocation {
  readonly allocationId: string;
  readonly scheduledMinutes: number;
  readonly consumedMinutes: number;
  readonly releasedMinutes: number;
}

export interface HrsBalance {
  readonly issuedMinutes: number;
  readonly consumedMinutes: number;
  readonly releasedMinutes: number;
  readonly remainingMinutes: number;
}

function assertMinutes(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer number of minutes`);
  }
}

/** Mint scheduled capacity. This reserves time only; it does not create earned wages. */
export function mintScheduledHrs(allocationId: string, minutes: number): HrsAllocation {
  assertMinutes(minutes, "minutes");
  if (!allocationId.trim()) throw new Error("allocationId is required");
  return { allocationId, scheduledMinutes: minutes, consumedMinutes: 0, releasedMinutes: 0 };
}

/** Consume only verified, positive work time and never exceed an allocation. */
export function consumeWorkedHrs(allocation: HrsAllocation, minutes: number): HrsAllocation {
  assertMinutes(minutes, "minutes");
  const available = allocation.scheduledMinutes - allocation.consumedMinutes - allocation.releasedMinutes;
  if (minutes > available) throw new Error("Verified work exceeds remaining scheduled HRS allocation");
  return { ...allocation, consumedMinutes: allocation.consumedMinutes + minutes };
}

/** Release unused scheduled capacity after a schedule change or period close. */
export function releaseUnusedHrs(allocation: HrsAllocation, minutes?: number): HrsAllocation {
  const available = allocation.scheduledMinutes - allocation.consumedMinutes - allocation.releasedMinutes;
  const release = minutes ?? available;
  assertMinutes(release, "minutes");
  if (release > available) throw new Error("Cannot release more HRS than remain allocated");
  return { ...allocation, releasedMinutes: allocation.releasedMinutes + release };
}

export function getHrsBalance(allocation: HrsAllocation): HrsBalance {
  const remainingMinutes = allocation.scheduledMinutes - allocation.consumedMinutes - allocation.releasedMinutes;
  if (remainingMinutes < 0) throw new Error("HRS allocation is overdrawn");
  return {
    issuedMinutes: allocation.scheduledMinutes,
    consumedMinutes: allocation.consumedMinutes,
    releasedMinutes: allocation.releasedMinutes,
    remainingMinutes
  };
}

/** Convert minutes to a display quantity; persistence must continue using integer minutes. */
export function formatHrs(minutes: number): string {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error("minutes must be a non-negative safe integer");
  return (minutes / 60).toFixed(2);
}
