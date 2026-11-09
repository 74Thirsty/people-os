/**
 * PeopleOS-controlled HRS token wallet model.
 * Employees receive no keys, signing authority, transfer API, or direct wallet access.
 */
export type HrsEntryKind = "mint" | "consume" | "release" | "correction";
export interface HrsWallet {
  readonly custodyMode: "peopleos_custody";
  readonly walletId: string;
  readonly tenantId: string;
  readonly employeeId: string;
  readonly custodian: "peopleos";
  readonly employeeAccess: false;
  readonly signingKeyReference: string;
}
export interface HrsTokenEntry {
  readonly idempotencyKey: string;
  readonly walletId: string;
  readonly allocationId: string;
  readonly kind: HrsEntryKind;
  readonly units: number;
  readonly occurredAt: string;
  readonly sourceReference: string;
}
export interface HrsWalletState { readonly wallet: HrsWallet; readonly entries: readonly HrsTokenEntry[]; }
export interface HrsValuationQuote {
  readonly token: "HRS";
  readonly quoteCurrency: string;
  readonly priceMicrosPerHrs: bigint;
  readonly source: "internal_model" | "external_market_observation";
  readonly observedAt: string;
  readonly methodologyVersion: string;
}
export interface HrsValuation {
  readonly units: number;
  readonly quoteCurrency: string;
  readonly valueMicros: bigint;
  readonly isRedeemable: false;
}
function assertUnits(units: number): void {
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error("HRS units must be a positive safe integer");
}
export function createCustodialHrsWallet(input: {
  walletId: string; tenantId: string; employeeId: string; signingKeyReference: string;
}): HrsWallet {
  for (const [name, value] of Object.entries(input)) if (!value.trim()) throw new Error(name + " is required");
  return Object.freeze({
    walletId: input.walletId, tenantId: input.tenantId, employeeId: input.employeeId,
    custodyMode: "peopleos_custody", custodian: "peopleos", employeeAccess: false, signingKeyReference: input.signingKeyReference
  });
}
export function getHrsWalletBalance(state: HrsWalletState): number {
  return state.entries.reduce((balance, entry) => {
    if (entry.walletId !== state.wallet.walletId) throw new Error("Cross-wallet ledger entry");
    return balance + (entry.kind === "mint" || entry.kind === "correction" ? entry.units : -entry.units);
  }, 0);
}
export function postHrsEntry(state: HrsWalletState, entry: HrsTokenEntry): HrsWalletState {
  assertUnits(entry.units);
  if (entry.walletId !== state.wallet.walletId) throw new Error("Wallet mismatch");
  if (!entry.idempotencyKey.trim() || !entry.sourceReference.trim()) throw new Error("Idempotency key and source reference are required");
  if (state.entries.some((item) => item.idempotencyKey === entry.idempotencyKey)) return state;
  if (getHrsWalletBalance(state) + (entry.kind === "mint" || entry.kind === "correction" ? entry.units : -entry.units) < 0) {
    throw new Error("HRS wallet cannot be overdrawn");
  }
  return Object.freeze({ wallet: state.wallet, entries: [...state.entries, Object.freeze(entry)] });
}
export function valueHrs(units: number, quote: HrsValuationQuote): HrsValuation {
  assertUnits(units);
  if (quote.priceMicrosPerHrs < BigInt(0)) throw new Error("Valuation quote cannot be negative");
  if (!quote.quoteCurrency.trim() || !quote.methodologyVersion.trim()) throw new Error("Quote currency and methodology version are required");
  return Object.freeze({
    units, quoteCurrency: quote.quoteCurrency, valueMicros: BigInt(units) * quote.priceMicrosPerHrs,
    isRedeemable: false
  });
}
export function assertHrsNotUsedAsWages(): never {
  throw new Error("HRS valuation cannot be used to calculate, accrue, or pay employee wages");
}
