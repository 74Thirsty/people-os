# HRS custodial token and valuation architecture

## Product definition
HRS is PeopleOS's proprietary custodial token for schedule and work accounting. One HRS represents one scheduled hour; timekeeping retains integer-minute precision. PeopleOS controls every wallet and all signing authority. Employees receive no HRS wallet access, keys, transfer capability, or withdrawal capability.

The current foundation is an internal PostgreSQL custody ledger. It defines wallet attribution, immutable token entries, and separate valuation observations. It does not yet deploy an external blockchain token or connect to a custody provider.

## Three independent systems
1. Custodial HRS token ledger: schedule minting, verified-work consumption, unused allocation release, and corrections.
2. Earned-value/payroll ledger: verified compensable time valued using effective-dated pay rates and deterministic payroll rules. HRS quantity and valuation are never wage-calculation inputs.
3. HRS valuation/economics: separately versioned internal valuation models and external market observations. HRS valuation may change independently of its timekeeping role; an observation does not itself create redemption rights or employee wage entitlements.

## Custody and security
- Private keys are never stored in PostgreSQL, agent files, logs, source control, or browser code.
- The signing-key reference is an opaque identifier resolved only by a dedicated KMS/HSM-backed custody service or qualified custodian.
- No employee signing, transfer, withdrawal, seed phrase, wallet export, or direct wallet API.
- Postings must be server-side, tenant-scoped, atomic, idempotent, authorized, and auditable.
- Wallets can be frozen. Corrections are compensating entries.
- Agents may initiate authorized workflows but cannot sign transactions or write ledger tables.

## HRS lifecycle
1. Approved schedule version mints HRS to the employee-attributed custodial wallet (40 scheduled hours = 40 HRS).
2. Authenticated clock events and approved corrections consume HRS as verified work occurs.
3. Schedule changes release unused allocation without deleting history.
4. Work beyond allocation becomes a verified-time exception, not discarded work or a negative wallet balance.
5. Period close reconciles minted, consumed, released, and exception quantities.

## Valuation boundary
HRS's internal accounting function does not mathematically cap its independent token valuation. The system records quote currency, timestamp, source, evidence reference, and methodology version. Modeled values must be labeled as models; market values require verifiable market evidence. No price appreciation is promised or assumed.

This foundation does not launch a public token, exchange, market, liquidity pool, redemption program, or price-support mechanism. External issuance, transferability, listing, liquidity, buybacks, or marketing of appreciation require a separately approved token-economics specification and specialist legal review. Do not manufacture volume, manipulate price, or misstate backing.

## Earned value and payout boundary
Verified work is valued independently using employee compensation terms and deterministic payroll calculations. On-demand payout is a separate workflow against eligible earned compensation, with earning references, payout reservations, provider idempotency, settlement confirmation, reversals, and reconciliation. HRS tokens and HRS market valuation are not employee wages and are not cashed out by employees.

No live payout or external token operation is enabled by this foundation.
