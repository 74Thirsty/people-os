# PeopleOS

![Sheen Banner]([https://github.com/74Thirsty/74Thirsty/blob/main/assets/PeopleOS_Logo_Banner.png)

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
Next.js App Router, React, TypeScript, Supabase PostgreSQL/Auth/Storage, Zod, Vitest, Vyper, Titanoboa, and GitHub Actions. Planned integrations: telephony/SMS, Microsoft Graph, payroll provider, and qualified custody infrastructure.

## Layout
- `src/app`: employer command center, authentication, tenant onboarding, and API routes
- `src/lib`: shared schemas, Supabase clients, and deterministic services
- `tenants/template`: business configuration, agent instructions, workflows
- `supabase/migrations`: database schema, row-level security, HRS RPCs, tenant onboarding, and storage policies
- `contracts/src`: Vyper on-chain contracts
- `contracts/tests`: local EVM contract tests
- `contracts/README.md`: contract custody model and deployment gates
- `docs/supabase-application-setup.md`: Supabase setup and migration guide
- `docs/hrs-custodial-token-economics.md`: custodial HRS and valuation architecture
- `.github/workflows`: application, database, and contract CI

## Local development
Requires Node.js 22 and npm.

    cp .env.example .env.local
    npm ci
    npm run dev

Required application variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Server-only HRS integration variable:
- `SUPABASE_SERVICE_ROLE_KEY` (never expose to a browser, employee, or agent)

## Supabase setup
Review [the Supabase application setup guide](docs/supabase-application-setup.md). The migration sequence is 001 through 005. Configure Auth Site URL and the `/auth/callback` redirect allow-list before using email magic links.

## Contract development and tests
Requires Python 3.12.

    python -m pip install -r contracts/requirements.txt
    vyper contracts/src/HrsToken.vy
    vyper contracts/src/HrsController.vy
    python -m pytest contracts/tests -q

The Vyper contract workflow runs compilation and local EVM tests on pull requests and pushes to `main`.

## Validation
    npm run typecheck
    npm run lint
    npm test
    npm run build
    npm audit --audit-level=high

To intentionally refresh the committed dependency lockfile after changing `package.json`, run `npm run lockfile:refresh` and commit both files.

## Release status
The application has Supabase SSR/browser/admin client boundaries, email magic-link authentication, authenticated tenant onboarding, a tenant-isolated employer dashboard, a private document bucket with tenant-folder policies, and HRS database posting primitives. The application migration has not yet been applied to a real Supabase project because no project reference or credentials were supplied in the build session.

The Vyper HRS token and idempotent mint/burn controller are in the repository with local EVM tests. They are not deployed or independently audited. The PostgreSQL HRS ledger is not yet connected to the chain. No live chain issuance, external market, swap, employee payout, or payroll disbursement is enabled. See `contracts/README.md` for the remaining controls and deployment gates.

Never put service-role keys, provider secrets, tax identifiers, bank details, private keys, seed phrases, or sensitive employee data in agent files or source control.
