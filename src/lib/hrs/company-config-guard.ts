import type { CompanyConfig } from "@/lib/company-config/schema";
import { authorizeApproval, getApprovalRule } from "@/lib/company-config/access";
import { resolvePayPeriod } from "@/lib/company-config/timekeeping";
import type {
  ApprovedHrsSchedule,
  HrsWorkflowVerifiers,
  VerifiedHrsClockEvent
} from "@/lib/hrs-workflows";

/**
 * Wraps trusted HRS verifiers with the active tenant's schedule approval and
 * time-token rules. The database still enforces custody and balance limits.
 */
export function createConfiguredHrsVerifiers(
  config: CompanyConfig,
  approverRoleId: string,
  base: HrsWorkflowVerifiers
): HrsWorkflowVerifiers {
  if (config.payroll.timeTokens.isWages !== false || config.payroll.timeTokens.cashOutEnabled !== false) {
    throw new Error("HRS time tokens must never be treated as wages or a cash-out balance");
  }
  getApprovalRule(config, "schedule_change");
  return Object.freeze({
    async authorizeSchedule(schedule: ApprovedHrsSchedule) {
      const approval = authorizeApproval(config, "schedule_change", approverRoleId);
      if (!approval.allowed) throw new Error(`Schedule publication denied: ${approval.reason}`);
      const dated = schedule as ApprovedHrsSchedule & { periodStart?: string; periodEnd?: string };
      if (dated.periodStart && dated.periodEnd) {
        const period = resolvePayPeriod(config, dated.periodStart);
        if (dated.periodStart < period.start && dated.periodEnd > period.end) {
          throw new Error("Schedule spans more than one configured pay period");
        }
      }
      await base.authorizeSchedule(schedule);
    },
    async verifyClockEvent(event: VerifiedHrsClockEvent) {
      await base.verifyClockEvent(event);
    }
  });
}

export function configuredPayPeriodKey(config: CompanyConfig, dateOnly: string): string {
  return resolvePayPeriod(config, dateOnly).key;
}
