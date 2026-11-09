/**
 * Server-side adapter for the atomic HRS posting RPCs.
 *
 * Pass a Supabase service-role client from trusted server code only.
 * Never import this module into client components or expose service-role credentials.
 * Clock evidence must be authenticated and validated before calling consume().
 */
export type HrsPostingType = "mint" | "consume" | "release" | "correction";
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
  actorType?: "manager" | "administrator" | "agent" | "system" | "provider";
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
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
async function call(
  client: HrsRpcClient,
  entryType: HrsPostingType,
  input: HrsPostingInput
): Promise<string> {
  validate(input);
  const { data, error } = await client.rpc("post_hrs_allocation_event", {
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
  if (error) throw new Error("HRS " + entryType + " failed: " + error.message);
  if (typeof data !== "string" || !data) throw new Error("HRS posting RPC returned no ledger entry ID");
  return data;
}
export function createHrsPostingService(client: HrsRpcClient) {
  return Object.freeze({
    mintSchedule: (input: HrsPostingInput) => call(client, "mint", input),
    consumeVerifiedWork: (input: HrsPostingInput) => call(client, "consume", input),
    releaseUnusedSchedule: (input: HrsPostingInput) => call(client, "release", input),
    postCorrectionCredit: (input: HrsPostingInput) => call(client, "correction", input)
  });
}
