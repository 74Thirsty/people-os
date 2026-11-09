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
  if (typeof data !== "string" || !data) throw new Error("HRS RPC returned no UUID");
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
export function createHrsPostingService(client: HrsRpcClient) {
  return Object.freeze({
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
