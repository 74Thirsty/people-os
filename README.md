# PeopleOS
### The Operating System for Your Workforce.

PeopleOS is a phone-first, agent-driven workforce operating system. Employees interact through a company phone number using SMS, voice calls, and native smartphone dictation. Employers configure and oversee the system through a web command center.

## Product invariants
1. No mandatory employee app or employee portal.
2. Every company has isolated tenant data, policy, agents, workflows, integrations, and audit history.
3. Business-specific behavior is configured through versioned agent and workflow files.
4. Agents interpret and coordinate; deterministic services enforce permissions and execute consequential operations.
5. Payroll, tax, time, and accounting records are authoritative backend records—not LLM memory.
6. No agent can bypass tenant isolation, authorization, approval, or audit controls.
7. No live payroll or disbursement until jurisdiction, provider, tax, identity, and approval configuration is verified.
8. HRS is a proprietary PeopleOS-controlled custodial token; employees cannot access or transfer it.
9. HRS time accounting, earned compensation, and HRS valuation are independent systems.
10. No employee payout may be calculated from HRS token quantity or valuation.

## Stack
Next.js App Router, React, TypeScript, Supabase PostgreSQL/Auth, Zod, Vitest, GitHub Actions. Planned integrations: telephony/SMS, Microsoft Graph, payroll provider, and qualified custody infrastructure.

## Layout
- src/app: employer command center
- src/lib: shared schemas and services
- tenants/template: business configuration, agent instructions, workflows
- supabase/migrations: database schema and row-level security
- docs/hrs-and-earned-wage-access.md: HRS and on-demand earned-wage access architecture
- docs/hrs-custodial-token-economics.md: custodial HRS and valuation architecture
- .github/workflows: CI

## Local development
Requires Node.js 22 and npm.

    cp .env.example .env.local
    npm install
    npm run dev

## Validation
    npm run typecheck
    npm run lint
    npm test
    npm run build

## Release status
This is an engineering foundation, not a payroll-ready or custody-certified product. HRS wallet provisioning and atomic posting RPCs plus server-side TypeScript adapters now exist in the feature branch. They have not been applied to a Supabase project, wired to production schedule/clock-event sources, or connected to a KMS/HSM or qualified custody provider. The service-role key must never be exposed to browser or employee clients. No live HRS chain issuance, employee payout, or external token operation is enabled.

The trusted workflow requires production implementations of schedule authorization, employee identity verification, signed clock-event validation, replay protection, tenant RBAC, and audit-source retention before any posting is enabled. The database trusts only the service-role caller's evidence validation. Negative HRS correction/debit workflows and schedule revision automation remain unfinished.

Before production use, implement and test tenant provisioning, identity verification, server-side RBAC, signed telephony webhooks and replay protection, consent/retention, Microsoft Graph OAuth with least privilege, versioned agent loading/review/rollback, durable workflows, deterministic time/payroll/tax services, custodial key management, atomic HRS posting, earned-wage eligibility, provider payout/reconciliation, security testing, backup/restore, observability, and jurisdiction-specific legal review.

Never put service-role keys, provider secrets, tax identifiers, bank details, private keys, seed phrases, or sensitive employee data in agent files or source control.
