import { describe, expect, it } from "vitest";
import {
  createCustodialHrsWallet,
  getHrsWalletBalance,
  postHrsEntry,
  valueHrs,
  type HrsWalletState
} from "./hrs-custody";

const wallet = createCustodialHrsWallet({
  walletId: "wallet-1",
  tenantId: "tenant-1",
  employeeId: "employee-1",
  signingKeyReference: "secret-manager://peopleos/tenant-1/wallet-1"
});
const initial: HrsWalletState = { wallet, entries: [] };

describe("custodial HRS wallets", () => {
  it("creates a PeopleOS-custodied wallet with no employee access", () => {
    expect(wallet.custodian).toBe("peopleos");
    expect(wallet.custodyMode).toBe("peopleos_custody");
    expect(wallet.employeeAccess).toBe(false);
    expect("privateKey" in wallet).toBe(false);
  });

  it("mints scheduled units and consumes verified work", () => {
    const minted = postHrsEntry(initial, {
      idempotencyKey: "schedule:shift-1:v1",
      walletId: wallet.walletId,
      allocationId: "shift-1",
      kind: "mint",
      units: 8,
      occurredAt: "2026-11-09T08:00:00Z",
      sourceReference: "schedule:shift-1"
    });
    const consumed = postHrsEntry(minted, {
      idempotencyKey: "time:shift-1:4h",
      walletId: wallet.walletId,
      allocationId: "shift-1",
      kind: "consume",
      units: 4,
      occurredAt: "2026-11-09T12:00:00Z",
      sourceReference: "verified-time:shift-1"
    });
    expect(getHrsWalletBalance(consumed)).toBe(4);
  });

  it("is idempotent and cannot mint the same schedule twice", () => {
    const entry = {
      idempotencyKey: "schedule:shift-1:v1",
      walletId: wallet.walletId,
      allocationId: "shift-1",
      kind: "mint" as const,
      units: 8,
      occurredAt: "2026-11-09T08:00:00Z",
      sourceReference: "schedule:shift-1"
    };
    const once = postHrsEntry(initial, entry);
    expect(postHrsEntry(once, entry)).toBe(once);
    expect(getHrsWalletBalance(postHrsEntry(once, entry))).toBe(8);
  });

  it("rejects transfers/withdrawals by not defining such ledger operations and rejects overdrafts", () => {
    expect(() => postHrsEntry(initial, {
      idempotencyKey: "consume:too-much",
      walletId: wallet.walletId,
      allocationId: "shift-1",
      kind: "consume",
      units: 1,
      occurredAt: "2026-11-09T09:00:00Z",
      sourceReference: "verified-time:shift-1"
    })).toThrow(/overdrawn/);
  });

  it("values HRS separately without creating redemption rights", () => {
    const valuation = valueHrs(10, {
      token: "HRS",
      quoteCurrency: "USD",
      priceMicrosPerHrs: BigInt(1250000),
      source: "internal_model",
      observedAt: "2026-11-09T12:00:00Z",
      methodologyVersion: "v1"
    });
    expect(valuation.valueMicros).toBe(BigInt(12500000));
    expect(valuation.isRedeemable).toBe(false);
  });
});
