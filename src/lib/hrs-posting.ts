/**
 * Server-side adapter for atomic HRS custody RPCs.
 * Supply a Supabase service-role client from trusted server code only.
 * Never import into client components or expose service-role credentials.
 * The caller must authenticate schedule approvals, clock evidence, and manager RBAC.
 */
export type HrsPostingType = "mint" | "consume" | "release" | "correction";
export type HrsActorType = "manager" | "administrator" | "system" | "provider";
export interface HrsRpcError { message: string; code?: string; }
export interface HrsRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: HrsRpcError | null;
  }>;
}
export interface HrsPostingInput {
  tenantId: string;
  walletId: string;
  allocationId: string;
  units: number;
  idempotencyKey: string;
  sourceReference: string;
  occurredAt: string;
  actorType?: HrsActorType;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}
export interface HrsApprovedScheduleInput {
  tenantId: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  scheduledMinutes: number;
  scheduleVersion: string;
  approvedBy: string;
  approvedAt: string;
  sourceReference: string;
  signingKeyReference: string;
}
export interface HrsScheduleMintResult {
  walletId: string;
  allocationId: string;
  ledgerEntryId: string;
}
export interface HrsWalletProvisionInput {
  tenantId: string;
  employeeId: string;
  /** Opaque KMS/HSM key reference; never pass key material. */
  signingKeyReference: string;
}
function required(value: string, field: string): void {
  if (!value.trim()) throw new Error(field + " is required");
}
function validate(input: HrsPostingInput): void {
  required(input.tenantId, "tenantId");
  required(input.walletId, "walletId");
  required(input.allocationId, "allocationId");
  required(input.idempotencyKey, "idempotencyKey");
  required(input.sourceReference, "sourceReference");
  if (!Number.isSafeInteger(input.units) || input.units <= 0) {
    throw new Error("units must be a positive safe integer");
  }
  if (!Number.isFinite(Date.parse(input.occurredAt))) throw new Error("occurredAt must be a valid timestamp");
}
async function rpcUuid(client: HrsRpcClient, name: string, args: Record<string, unknown>): Promise<string> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error("HRS RPC failed: " + error.message);
  if (typeof data !== "string" || !data) {
    const missingValue = name === "post_hrs_allocation_event" ? "ledger entry ID" : "wallet ID";
    throw new Error("HRS RPC returned no " + missingValue);
  }
  return data;
}
async function post(
  client: HrsRpcClient,
  entryType: HrsPostingType,
  input: HrsPostingInput
): Promise<string> {
  validate(input);
  return rpcUuid(client, "post_hrs_allocation_event", {
    p_tenant_id: input.tenantId,
    p_wallet_id: input.walletId,
    p_allocation_id: input.allocationId,
    p_entry_type: entryType,
    p_units: input.units,
    p_idempotency_key: input.idempotencyKey,
    p_source_reference: input.sourceReference,
    p_occurred_at: input.occurredAt,
    p_actor_type: input.actorType ?? "system",
    p_actor_user_id: input.actorUserId ?? null,
    p_metadata: input.metadata ?? {}
  });
}
async function createAndMintSchedule(
  client: HrsRpcClient,
  input: HrsApprovedScheduleInput
): Promise<HrsScheduleMintResult> {
  required(input.tenantId, "tenantId");
  required(input.employeeId, "employeeId");
  required(input.periodStart, "periodStart");
  required(input.periodEnd, "periodEnd");
  required(input.scheduleVersion, "scheduleVersion");
  required(input.approvedBy, "approvedBy");
  required(input.sourceReference, "sourceReference");
  required(input.signingKeyReference, "signingKeyReference");
  if (!Number.isSafeInteger(input.scheduledMinutes) || input.scheduledMinutes <= 0) {
    throw new Error("scheduledMinutes must be a positive safe integer");
  }
  if (input.periodEnd < input.periodStart) throw new Error("periodEnd cannot precede periodStart");
  if (!Number.isFinite(Date.parse(input.approvedAt))) throw new Error("approvedAt must be a valid timestamp");
  const { data, error } = await client.rpc("create_and_mint_hrs_schedule", {
    p_tenant_id: input.tenantId,
    p_employee_id: input.employeeId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_scheduled_minutes: input.scheduledMinutes,
    p_schedule_version: input.scheduleVersion,
    p_approved_by: input.approvedBy,
    p_approved_at: input.approvedAt,
    p_source_reference: input.sourceReference,
    p_signing_key_reference: input.signingKeyReference
  });
  if (error) throw new Error("HRS schedule mint failed: " + error.message);
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error("HRS schedule mint RPC returned an invalid result");
  }
  const row = data[0] as Record<string, unknown>;
  if (typeof row.wallet_id !== "string" || typeof row.allocation_id !== "string" ||
      typeof row.ledger_entry_id !== "string") {
    throw new Error("HRS schedule mint RPC returned incomplete identifiers");
  }
  return { walletId: row.wallet_id, allocationId: row.allocation_id, ledgerEntryId: row.ledger_entry_id };
}
export function createHrsPostingService(client: HrsRpcClient) {
  return Object.freeze({
    createAndMintApprovedSchedule: (input: HrsApprovedScheduleInput) => createAndMintSchedule(client, input),
    provisionWallet: (input: HrsWalletProvisionInput) => {
      required(input.tenantId, "tenantId");
      required(input.employeeId, "employeeId");
      required(input.signingKeyReference, "signingKeyReference");
      return rpcUuid(client, "provision_hrs_wallet", {
        p_tenant_id: input.tenantId,
        p_employee_id: input.employeeId,
        p_signing_key_reference: input.signingKeyReference
      });
    },
    mintSchedule: (input: HrsPostingInput) => post(client, "mint", input),
    consumeVerifiedWork: (input: HrsPostingInput) => post(client, "consume", input),
    releaseUnusedSchedule: (input: HrsPostingInput) => post(client, "release", input),
    postCorrectionCredit: (input: HrsPostingInput) => post(client, "correction", input)
  });
}
