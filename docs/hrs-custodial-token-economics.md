# HRS custodial token and valuation architecture

## Product definition

HRS is PeopleOS's proprietary tokenized unit for internal workforce accounting. The system mints HRS against approved scheduled hours and consumes HRS as verified compensable work is recorded. One HRS represents one scheduled/work hour; the database stores integer units or minutes where fractional-hour precision is required.

**PeopleOS, not the employee, controls every HRS wallet.** Each employee has an attribution wallet/sub-ledger held in PeopleOS custody. Employees receive no private keys, seed phrases, signing capability, wallet credentials, transfer endpoint, withdrawal function, or direct wallet access. The employee interface shows time and compensation records—not HRS wallet controls.

## Three independent accounting/economic layers

1. **Custodial HRS token ledger:** schedule minting, verified-work consumption, release of unused scheduled allocation, and compensating corrections. Entries are tenant-scoped, immutable, idempotent, and controlled by the PeopleOS custody service.
2. **Earned-value/payroll ledger:** verified compensable minutes are valued using effective-dated pay rates and deterministic payroll rules. It tracks gross earned value, withholding/deductions, advances, eligibility, and available amount. HRS quantity or HRS valuation is never used as a wage calculation input.
3. **HRS valuation/economics:** a separate, versioned valuation layer may record internal model estimates or external market observations. A valuation quote is informational; it does not create a redemption right, employee entitlement, wage, deposit, or guaranteed price. Token utility, supply policy, demand assumptions, market access, and any issuance/transfer rules must be separately specified and reviewed.

## Custody and access controls

- Custody mode is PeopleOS-controlled; employee access is permanently false.
- Private keys are never stored in PostgreSQL, agent files, logs, source control, or browser code. Store key material in a dedicated KMS/HSM or qualified custody provider; the database holds only an opaque secret reference.
- No employee transfer, withdrawal, signing, or wallet export APIs.
- Agents may request authorized operations but cannot sign transactions, write ledger tables, or bypass custody policy.
- Wallet operations require tenant-scoped authorization, atomic balance checks, idempotency, immutable audit events, rate limits, and dual control for privileged treasury actions.
- Freeze capability must be available for suspected compromise, dispute, legal hold, or tenant offboarding.
- Never expose one tenant's wallet, balances, keys, or valuation configuration to another tenant.

## HRS lifecycle

1. Approved schedule version creates a mint event for scheduled hours.
2. Authenticated clock events and approved corrections create consumption events for verified compensable time.
3. Schedule changes release only unused allocation; they do not erase prior mint history.
4. Verified work above allocation is an exception, not silently discarded or allowed to overdraw a wallet.
5. Corrections are compensating entries; no historical ledger row is edited or deleted.

## Valuation design boundary

The system can support a token with separately determined market value. Internal HRS accounting does not mathematically cap that value at one hour or at an employee's pay rate. However, this foundation does not launch a public token, promise appreciation, create a market, or implement price support. A market price must come from a disclosed, defensible methodology or actual market observations—not fabricated quotes.

Before external issuance, listing, transferability, liquidity provision, redemption, buybacks, or marketing of potential appreciation, obtain specialist review of securities, commodities, money-transmission, custody, tax, consumer-protection, and other applicable requirements. Do not manipulate price, manufacture volume, misstate backing, or describe a modeled valuation as a market price.

## Earned value and payout boundary

Verified work is valued independently using the employee's pay rate and deterministic payroll calculations. Any on-demand payout is a separate workflow against eligible earned compensation, with unique earning references, payout reservations, provider idempotency, settlement confirmation, reversal handling, and reconciliation. HRS tokens and HRS market valuation are never cashed out as employee wages.

No live payout or external token operation is enabled by this schema/domain foundation. Those require dedicated provider/custody integrations, tested authorization, operational controls, and jurisdiction-specific review.
