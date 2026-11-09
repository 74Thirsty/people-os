# HRS custodial token and valuation architecture

## Product definition
HRS is PeopleOS's proprietary custodial token for schedule and work accounting. One HRS represents one scheduled hour; timekeeping retains integer-minute precision. PeopleOS controls every wallet and all signing authority. Employees receive no HRS wallet access, keys, transfer capability, or withdrawal capability.

The repository contains a Vyper 0.4.3 HRS token at `contracts/src/HrsToken.vy` and an idempotent mint/burn controller at `contracts/src/HrsController.vy`. Mint and burn are delegated to the controller; each operation requires an approved operator and a unique 32-byte ID. The token restricts holders, senders, receivers, and spenders to an explicit PeopleOS custody/protocol allowlist. These are source contracts only; they have not been deployed, independently audited, or connected to the application. The existing PostgreSQL custody ledger remains separate and is not itself an on-chain token. `src/lib/hrs-token-units.ts` converts minute totals into 18-decimal HRS base units using cumulative rounding so minute-by-minute events do not accumulate rounding drift. See [the contract implementation notes](../contracts/README.md) for explicit deployment gates.

## Three independent systems
1. **Custodial HRS token ledger:** schedule minting, verified-work consumption, unused allocation release, and positive manager-approved correction credits.
2. **Earned-value/payroll ledger:** verified compensable time valued using effective-dated pay rates and deterministic payroll rules. HRS quantity and valuation are never wage-calculation inputs.
3. **HRS valuation/economics:** separately versioned internal valuation models and external market observations. HRS valuation may change independently of its timekeeping role; an observation does not itself create redemption rights or employee wage entitlements.

## Custody and security
- Private keys are never stored in PostgreSQL, agent files, logs, source control, or browser code.
- The signing-key reference is an opaque identifier resolved only by a dedicated KMS/HSM-backed custody service or qualified custodian. The actual KMS integration is not yet implemented.
- No employee signing, transfer, withdrawal, seed phrase, wallet export, or direct wallet API.
- The SQL RPCs require the Supabase service role, run as security definer with a fixed search path, lock wallet/allocation rows, enforce tenant/employee linkage, and post idempotently.
- The TypeScript adapter is server-side only by convention; trusted callers must supply a service-role client and must not expose it to browser code.
- Workflow orchestration requires explicit schedule-authorization and clock-verification callbacks. Those callbacks must be implemented by the authenticated schedule/timekeeping services; they are not yet wired to a live clock-event source.
- The posting RPC trusts the service-role caller's assertion that source evidence and manager authorization have been validated. It does not independently verify SMS/telephony signatures or employee identity.
- Wallets can be frozen. Ledger corrections are compensating entries.
- Agents may initiate authorized workflows but cannot call the service-role RPC or sign transactions.
- On-chain admin, minter, and burner roles must be held by PeopleOS-controlled multisig/custody infrastructure. Employees must never receive a signing key or signer role.

## HRS lifecycle
1. The trusted workflow authorizes an approved schedule, then one database transaction creates its hrs_allocations record, provisions or resolves the employee-attributed custodial wallet, and mints exactly its scheduled minutes.
2. Authenticated clock events are validated by the timekeeping service. The trusted workflow consumes verified compensable minutes, excluding unpaid breaks.
3. Schedule changes release unused allocation without deleting history. Revised schedules should use a new approved allocation/version.
4. Work beyond allocation becomes a verified-time exception, not discarded work or a negative wallet balance.
5. Period close reconciles minted, consumed, released, corrected, and exception minutes.
6. The future chain adapter must reconcile database allocations with on-chain mint/burn events using idempotency keys, transaction hashes, confirmation depth, and reorg handling. That adapter does not yet exist.

## Valuation boundary
HRS's internal accounting function does not mathematically cap its independent token valuation. The system records quote currency, timestamp, source, evidence reference, and methodology version. Modeled values must be labeled as models; market values require verifiable market evidence. No price appreciation is promised or assumed.

The token contract does not implement a swap venue, liquidity pool, redemption program, buyback, or price-support mechanism. External issuance, listing, liquidity, buybacks, or marketing of appreciation require a separately approved token-economics specification and specialist legal review. Do not manufacture volume, manipulate price, or misstate backing.

## Earned value and payout boundary
Verified work is valued independently using employee compensation terms and deterministic payroll calculations. On-demand payout is a separate workflow against eligible earned compensation, with earning references, payout reservations, provider idempotency, settlement confirmation, reversals, and reconciliation. HRS tokens and HRS market valuation are not employee wages and are not cashed out by employees.

No live payout, swap, external market, or production token operation is enabled by the current implementation.
