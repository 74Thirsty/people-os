/**
 * HRS schedule accounting ledger.
 * Quantities are stored as integer minutes to avoid floating-point drift.
 * These database records are not on-chain token balances; see contracts/src/HrsToken.vy
 * for the separate ERC-20 implementation and contracts/README.md for deployment gates.
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
  /** Positive integer minutes. Direction is represented by type, never sign.