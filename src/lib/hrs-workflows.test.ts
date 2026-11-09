import { describe, expect, it, vi } from "vitest";
import { createHrsWorkflowService, type HrsWorkflowVerifiers } from "./hrs-workflows";
import type { HrsRpcClient } from "./hrs-posting";

function setup() {
  const rpc = vi.fn().mockResolvedValue({ data: "ledger-entry-1", error: null });
  const client = { rpc } as unknown as HrsRpcClient;
  const verifiers: HrsWorkflowVerifiers = {
    authorizeSchedule: vi.fn().mockResolvedValue(undefined),
    verifyClockEvent: vi.fn().mockResolvedValue(undefined)
  };
  return { rpc, verifiers, service: createHrsWorkflowService(client, verifiers) };
}
const schedule = {
  tenantId: "tenant-1", employeeId: "employee-1", walletId: "wallet-1",
  allocationId: "allocation-1", scheduledMinutes: 2400,
  scheduleVersion: "v3", approvedBy: "manager-1", approvedAt: "2026-11-09T08:00:00Z"
};
const clockEvent = {
  tenantId: "tenant-1", employeeId: "employee-1", walletId: "wallet-1",
  allocationId: "allocation-1", eventId: "event-123", compensableMinutes: 450,
  occurredAt: "2026-11-09T12:00:00Z", verifiedBy: "time-service",
  verificationReference: "signed-clock-event:event-123"
};
describe("HRS trusted workflow orchestration", () => {
  it("creates the allocation, provisions custody, and mints in one atomic RPC after approval", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ wallet_id: "wallet-1", allocation_id: "allocation-1", ledger_entry_id: "entry-1" }],
      error: null
    });
    const client = { rpc } as unknown as HrsRpcClient;
    const verifiers: HrsWorkflowVerifiers = {
      authorizeSchedule: vi.fn().mockResolvedValue(undefined),
      verifyClockEvent: vi.fn().mockResolvedValue(undefined)
    };
    const service = createHrsWorkflowService(client, verifiers);
    const result = await service.createAndMintApprovedSchedule({
      tenantId: "tenant-1", employeeId: "employee-1",
      walletId: "wallet-1", allocationId: "allocation-1",
      scheduledMinutes: 2400, scheduleVersion: "v3",
      approvedBy: "manager-1", approvedAt: "2026-11-09T08:00:00Z",
      periodStart: "2026-11-09", periodEnd: "2026-11-15",
      signingKeyReference: "kms://peopleos/tenant-1/employee-1"
    });
    expect(verifiers.authorizeSchedule).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("create_and_mint_hrs_schedule", expect.objectContaining({
      p_scheduled_minutes: 2400, p_schedule_version: "v3"
    }));
    expect(result).toEqual({ walletId: "wallet-1", allocationId: "allocation-1", ledgerEntryId: "entry-1" });
  });

  it("authorizes an approved schedule before minting its exact scheduled minutes", async () => {
    const { rpc, verifiers, service } = setup();
    await service.mintApprovedSchedule(schedule);
    expect(verifiers.authorizeSchedule).toHaveBeenCalledWith(schedule);
    expect(rpc).toHaveBeenCalledWith("post_hrs_allocation_event", expect.objectContaining({
      p_entry_type: "mint", p_units: 2400, p_actor_type: "manager",
      p_idempotency_key: "schedule:allocation-1:v3"
    }));
  });
  it("verifies clock evidence before consuming compensable minutes", async () => {
    const { rpc, verifiers, service } = setup();
    await service.consumeVerifiedClockEvent(clockEvent);
    expect(verifiers.verifyClockEvent).toHaveBeenCalledWith(clockEvent);
    expect(rpc).toHaveBeenCalledWith("post_hrs_allocation_event", expect.objectContaining({
      p_entry_type: "consume", p_units: 450, p_actor_type: "system",
      p_idempotency_key: "clock-event:event-123"
    }));
  });
  it("does not mint when schedule authorization fails", async () => {
    const { rpc, verifiers, service } = setup();
    vi.mocked(verifiers.authorizeSchedule).mockRejectedValue(new Error("schedule approval denied"));
    await expect(service.mintApprovedSchedule(schedule)).rejects.toThrow(/approval denied/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not consume when clock verification fails", async () => {
    const { rpc, verifiers, service } = setup();
    vi.mocked(verifiers.verifyClockEvent).mockRejectedValue(new Error("invalid clock signature"));
    await expect(service.consumeVerifiedClockEvent(clockEvent)).rejects.toThrow(/signature/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects zero or fractional time after verification and before posting", async () => {
    const { rpc, service } = setup();
    await expect(service.consumeVerifiedClockEvent({ ...clockEvent, compensableMinutes: 0 })).rejects.toThrow(/positive integer/);
    await expect(service.consumeVerifiedClockEvent({ ...clockEvent, compensableMinutes: 4.5 })).rejects.toThrow(/positive integer/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
