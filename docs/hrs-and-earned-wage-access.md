# HRS and on-demand earned wage access

## Product definition

**HRS** is PeopleOS's proprietary, employee-specific unit for tracking scheduled and verified work time. One HRS equals one hour; persistence uses integer minutes (60 minutes = 1 HRS) so partial shifts are exact. HRS is an internal accounting unit—not currency, a deposit, a transferable asset, a security, or a blockchain token.

The initial implementation is an off-chain, tenant-scoped ledger in PostgreSQL. Do not introduce a public blockchain, wallet, token exchange, transfer, or speculative token value.

## Lifecycle

1. **Schedule mint:** Once a schedule is approved, PeopleOS creates an allocation equal to scheduled minutes. Example: a 40-hour week receives an allocation of 2,400 minutes (40 HRS).
2. **Verified work consumption:** Authenticated clock events and approved time corrections consume allocated HRS as work is performed. Breaks and unpaid time do not consume HRS.
3. **Schedule changes:** Cancelled or reduced shifts release the unworked allocation. Released HRS are not wages and cannot be cashed out.
4. **Overages:** Work beyond an allocation is not silently discarded or forced into a negative balance. It is recorded as an exception and enters the verified-time approval path; approved overtime is handled by the deterministic payroll engine.
5. **Period close:** Reconcile schedule allocation, verified time, exceptions, leave treatment, and released capacity. Corrections append compensating ledger entries; never rewrite history.

## Separate time accounting from wage accounting

HRS measures time only. A separate earned-wage ledger values verified compensable time using the employee's effective-dated pay rate, jurisdiction, overtime rules, and applicable deductions. An HRS balance must never be multiplied by an assumed rate and treated as payable cash without a completed payroll calculation.

## On-demand access to earned wages

The employee experience should support requesting a payout of any amount up to the currently eligible earned-wage amount, including partial cash-outs. PeopleOS must calculate the eligible amount deterministically and account for prior advances, fees, withholding/tax treatment, garnishments, reversals, and provider limits.

The employer may pre-fund or maintain a designated payroll funding balance with an approved provider. PeopleOS records funding, available provider balance, payout requests, provider confirmations, fees, and reconciliation. Funding held by a provider is not an HRS balance and must not be represented as employee wages until earned under applicable rules.

**No direct money movement is part of the HRS ledger.** Actual payouts must go through a vetted payroll / earned-wage-access / payment provider after legal and jurisdiction review. Before enabling this feature, determine whether the product or provider arrangement triggers federal or state wage-payment, earned-wage-access, money-transmission, lending, fee, disclosure, payroll-tax, or other obligations. Do not assume that calling a payout an advance or using an internal token removes those obligations.

## Security and accounting invariants

- Every allocation and ledger entry is tenant- and employee-scoped.
- Posting must be server-side, authorized, idempotent, atomic, and auditable.
- The LLM can interpret a schedule or clock-in request but cannot mint, consume, release, or adjust HRS directly.
- Clock events require identity checks and replay protection; corrections require a reason and actor.
- Ledger entries are append-only. Corrections use compensating entries with source references.
- Employees may view their own time and earned-wage information; managers see only authorized employees; administrators and auditors have explicitly scoped access.
- Never let a business agent file override the platform's ledger, authorization, identity, or legal controls.
- Do not permit HRS transfers between employees or tenants.
- No employee payout may exceed the eligible earned-wage amount or be processed twice. Use idempotency keys and provider reconciliation.

## Release gates

Do not activate production minting, employee cash-outs, employer prefunding, or payment provider calls until all of the following are implemented and tested:

1. Server-side posting function with allocation locking and mint/consume/release invariants.
2. Identity-verified clock-in/out and break handling, including duplicate and out-of-order webhook tests.
3. Effective-dated compensation and deterministic overtime/pay calculations.
4. Earned-wage eligibility calculation with jurisdiction-specific policy and required disclosures.
5. Provider due diligence, funding reconciliation, payout idempotency, reversals, failure handling, and audit evidence.
6. Role/tenant authorization, employee data access controls, security testing, and legal/payroll review for each launch jurisdiction.

Until then, HRS is a schema and domain-model foundation only. No live balance, wages, or cash-out availability should be displayed as real.
