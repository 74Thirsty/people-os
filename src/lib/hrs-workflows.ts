/**
 * Trusted HRS event orchestration.
 *
 * The verifier callbacks must be implemented by the authenticated schedule and
 * timekeeping services. They must validate tenant/employee identity, approval
 * authority, webhook signature or trusted clock source, replay protection,
 * break treatment, timezone, and source-record integrity. This module does not
 * treat agent-supplied claims as evidence.
 */
import {
  createHrsPostingService,
  type HrsPostingInput,
  type HrsRpcClient
} from "./hrs-posting";

export interface ApprovedHrsSchedule {
  tenantId: string;
  employeeId: string;
  walletId: string;
  allocationId: string;
  scheduledMinutes: number;
  scheduleVersion: string;
  approvedBy: string;
  approvedAt: string;
}
export interface ApprovedHrsScheduleForProvisioning extends ApprovedHrsSchedule {
  periodStart: string;
  periodEnd: string;
  signingKeyReference: string;
}
export interface VerifiedHrsClockEvent {
  tenantId: string;
  employeeId: string;
  walletId: string;
  allocationId: string;
  eventId: string;
  compensableMinutes: number;
  occurredAt: string;
  verifiedBy: string;
  verificationReference: string;
}
export interface HrsWorkflowVerifiers {
  authorizeSchedule(schedule: ApprovedHrsSchedule): Promise<void>;
  verifyClockEvent(event: VerifiedHrsClockEvent): Promise<void>;
}
function assertPositiveMinutes(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(field + " must be a positive integer number of minutes");
  }
}
export function createHrsWorkflowService(client: HrsRpcClient, verifiers: HrsWorkflowVerifiers) {
  const posting = createHrsPostingService(client);
  return Object.freeze({
    async createAndMintApprovedSchedule(schedule: ApprovedHrsScheduleForProvisioning) {
      await verifiers.authorizeSchedule(schedule);
      assertPositiveMinutes(schedule.scheduledMinutes, "scheduledMinutes");
      return posting.createAndMintApprovedSchedule({
        tenantId: schedule.tenantId,
        employeeId: schedule.employeeId,
        periodStart: schedule.periodStart,
        periodEnd: schedule.periodEnd,
        scheduledMinutes: schedule.scheduledMinutes,
        scheduleVersion: schedule.scheduleVersion,
        approvedBy: schedule.approvedBy,
        approvedAt: schedule.approvedAt,
        sourceReference: "approved-schedule:" + schedule.employeeId + ":" + schedule.scheduleVersion,
        signingKeyReference: schedule.signingKeyReference
      });
    },
    async mintApprovedSchedule(schedule: ApprovedHrsSchedule): Promise<string> {
      await verifiers.authorizeSchedule(schedule);
      assertPositiveMinutes(schedule.scheduledMinutes, "scheduledMinutes");
      const input: HrsPostingInput = {
        tenantId: schedule.tenantId,
        walletId: schedule.walletId,
        allocationId: schedule.allocationId,
        units: schedule.scheduledMinutes,
        idempotencyKey: "schedule:" + schedule.allocationId + ":" + schedule.scheduleVersion,
        sourceReference: "approved-schedule:" + schedule.allocationId + ":" + schedule.scheduleVersion,
        occurredAt: schedule.approvedAt,
        actorType: "manager",
        actorUserId: schedule.approvedBy,
        metadata: { scheduleVersion: schedule.scheduleVersion }
      };
      return posting.mintSchedule(input);
    },
    async consumeVerifiedClockEvent(event: VerifiedHrsClockEvent): Promise<string> {
      await verifiers.verifyClockEvent(event);
      assertPositiveMinutes(event.compensableMinutes, "compensableMinutes");
      const input: HrsPostingInput = {
        tenantId: event.tenantId,
        walletId: event.walletId,
        allocationId: event.allocationId,
        units: event.compensableMinutes,
        idempotencyKey: "clock-event:" + event.eventId,
        sourceReference: event.verificationReference,
        occurredAt: event.occurredAt,
        actorType: "system",
        metadata: { eventId: event.eventId, verifiedBy: event.verifiedBy }
      };
      return posting.consumeVerifiedWork(input);
    }
  });
}
