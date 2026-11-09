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
7. No live payroll or disbursement until jurisdiction, provider, tax, identity, and approval configuration is verified.\n8. HRS is a proprietary internal hour-accounting unit; it is not currency or a transferable crypto-token.\n9. Scheduled HRS, verified worked time, earned wages, and cash payouts are separate ledgers and states.\n10. Employee cash-outs may use only deterministically calculated eligible earned wages and an approved payout provider.

## Stack
Next.js App Router, React, TypeScript, Supabase PostgreSQL/Auth, Zod, Vitest, GitHub Actions. Planned integrations: telephony/SMS, Microsoft Graph, payroll provider.

## Layout
- `src/app`: employer command center
- `src/lib`: shared schemas and services
- `tenants/template`: business configuration, agent instructions, workflows
- `supabase/migrations`: database schema and row-level security\n- `docs/hrs-and-earned-wage-access.md`: HRS and on-demand earned-wage access architecture
- `.github/workflows`: CI

## Local development
Requires Node.js 22 and npm.

```bash
cp .env.example .env.local
npm install
npm run dev
```

The initial dashboard intentionally displays unconfigured states; it does not fabricate employee, attendance, or payroll data.

## Validation
```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Release status
This is an initial engineering foundation, not a payroll-ready or compliance-certified product. The initial database migration provides read-only tenant-member policies. Write paths must be introduced with server-side authorization, approval controls, idempotency, and audit logging.

Before production use, implement and test tenant provisioning, identity verification, server-side RBAC, signed telephony webhooks and replay protection, consent/retention, Microsoft Graph OAuth with least privilege, versioned agent loading/review/rollback, durable workflows, time/leave/payroll/tax services, HRS posting invariants, earned-wage eligibility, provider payout/reconciliation, security testing, backup/restore, observability, and jurisdiction-specific legal/payroll review. HRS tables currently have read-only member policies; no production posting or payout path exists.

Never put service-role keys, provider secrets, tax identifiers, bank details, or sensitive employee data in agent files or source control.
