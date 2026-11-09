import { describe, expect, it, vi } from "vitest";
import { createHrsPostingService, type HrsRpcClient } from "./hrs-posting";

function makeClient(data: unknown = "entry-1", error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, client: { rpc } as unknown as HrsRpcClient };
}
const input = {
  tenantId: "tenant-1", walletId: "wallet-1", allocationId: "allocation-1",
  units: 2400, idempotencyKey: "schedule:allocation-1:v1",
  sourceReference: "approved-schedule:allocation-1",
  occurredAt: "2026-11-09T08:00:00.000Z"
};
describe("HRS server posting adapter", () => {
  it("provisions a custodial wallet using only an opaque key reference", async () => {
    const { rpc, client } = makeClient("wallet-1");
    const result = await createHrsPostingService(client).provisionWallet({
      tenantId: "tenant-1",
      employeeId: "employee-1",
      signingKeyReference: "kms://peopleos/tenant-1/employee-1"
    });
    expect(result).toBe("wallet-1");
    expect(rpc).toHaveBeenCalledWith("provision_hrs_wallet", {
      p_tenant_id: "tenant-1",
      p_employee_id: "employee-1",
      p_signing_key_reference: "kms://peopleos/tenant-1/employee-1"
    });
  });

  it("calls the atomic schedule mint RPC with integer minutes", async () => {
    const { rpc, client } = makeClient();
    const result = await createHrsPostingService(client).mintSchedule(input);
    expect(result).toBe("entry-1");
    expect(rpc).toHaveBeenCalledWith("post_hrs_allocation_event", expect.objectContaining({
      p_entry_type: "mint", p_units: 2400, p_tenant_id: "tenant-1"
    }));
  });
  it("routes verified work through consume and preserves idempotency reference", async () => {
    const { rpc, client } = makeClient("entry-2");
    await createHrsPostingService(client).consumeVerifiedWork({
      ...input, idempotencyKey: "time:event-123", sourceReference: "verified-time:event-123", units: 315
    });
    expect(rpc).toHaveBeenCalledWith("post_hrs_allocation_event", expect.objectContaining({
      p_entry_type: "consume", p_units: 315, p_idempotency_key: "time:event-123"
    }));
  });
  it("rejects invalid units before invoking the database", async () => {
    const { rpc, client } = makeClient();
    await expect(createHrsPostingService(client).mintSchedule({ ...input, units: 0 })).rejects.toThrow(/positive safe integer/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("surfaces database authorization or invariant failures", async () => {
    const { client } = makeClient(null, { message: "service_role required" });
    await expect(createHrsPostingService(client).mintSchedule(input)).rejects.toThrow(/service_role required/);
  });
  it("rejects an RPC response without a ledger entry id", async () => {
    const { client } = makeClient(null);
    await expect(createHrsPostingService(client).mintSchedule(input)).rejects.toThrow(/no ledger entry ID/);
  });
});
