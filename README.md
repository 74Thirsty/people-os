# PeopleOS

![PeopleOS Banner](https://github.com/74Thirsty/74Thirsty/blob/main/assets/PeopleOS_Logo_Banner.png)

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
Next.js App Router, React, TypeScript, Supabase PostgreSQL/Auth/Storage, Zod, Ajv JSON Schema validation, Vitest, Vyper, Titanoboa, and GitHub Actions. Microsoft Graph and Twilio SMS/MMS/voice clients are implemented; live connectivity requires provisioned credentials. Payroll provider and qualified custody infrastructure remain gated.

## Setup

### Prerequisites
- Node.js 22.12+ and npm 10.9+
- A Supabase project — the app uses Supabase Auth, PostgreSQL, and Storage with no fallback; without it the server answers every page with a 503 "not configured" notice
- KDE Wallet wallet `kdewallet`, folder `PEOPLEOS`, holding every sensitive value (KWallet entry name = exact variable name)

### Install and configure

```sh
cp .env.example .env.local
npm ci
npm run env:sync
```

`.env.local` is THE authoritative list of every environment variable. `npm run env:sync` scans the codebase for variable usage, ensures every one is present in `.env.local`, never prints values, and fails if a credential-like value sits where a `keyring` marker belongs.

Secrets rules: `.env.local` is gitignored. Sensitive values — anything obtained by logging into an account — are stored as the literal marker `keyring` in `.env.local`; the real values live in KWallet folder `PEOPLEOS` under the exact variable name. Non-sensitive settings carry their real values directly in `.env.local`. `npm run dev`, `build`, and `start` run through `scripts/with-keyring.mjs`, which resolves `keyring` markers from KWallet at launch, so real secrets never touch disk. Never commit a secret; never paste one into an issue, log, or chat.

### Supabase

1. Create a Supabase project.
2. Store its account-derived values in KWallet folder `PEOPLEOS` under entry names that exactly match the variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) — all three stay `keyring` in `.env.local`.
3. Apply all six migrations in order (`202611090001` through `202611100001`) — instructions in [docs/supabase-application-setup.md](docs/supabase-application-setup.md):

   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

4. In Supabase Auth, set the Site URL to your app URL and add `http://localhost:3000/auth/callback` to the redirect allow-list for local development.

### Run

```sh
npm run dev
```

Open http://localhost:3000 — unauthenticated visitors are redirected to `/login` for an email magic-link sign-in. First sign-in with no workspace lands on `/setup` to create one.

### Validation

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm audit --audit-level=high
```

## Layout
- `src/app`: employer command center, authentication, tenant onboarding, and API routes
- `src/lib`: shared schemas, Supabase clients, and deterministic services
- `tenants/<slug>/company.json`: versioned, tenant-specific universal configuration
- `schemas/company-config.schema.json`: language-neutral company configuration schema
- `supabase/migrations`: database schema, row-level security, HRS RPCs, tenant onboarding, and storage policies
- `contracts/src`: Vyper on-chain contracts
- `contracts/tests`: local EVM contract tests
- `scripts/sync-env.mjs` (`npm run env:sync` — env-file completeness checker) and `scripts/with-keyring.mjs` (KWallet-resolving launcher used by `dev`/`build`/`start`)
- `docs/`: user guide and deep-dive documentation
- `diagnostics/`: directive reports — verification evidence for environment, secrets, and integration work
- `AGENTS.md`: session state and edit log for coding agents (append-only)
- `.github/workflows`: application, database, and contract CI

## Company configuration

Each company is described by a self-contained `tenants/<slug>/company.json` document validated against `schemas/company-config.schema.json` and the cross-field rules in `src/lib/company-config/schema.ts`. The active configuration version drives employee roles and permissions, HR policy enforcement, approval authority, pay periods, overtime and break calculations, agent instructions, Microsoft/telephony integration resolution, and administrative controls.

Provisioning a repository tenant is an authorized platform operation:

1. Add and validate the company JSON configuration.
2. Set `PEOPLEOS_PLATFORM_ADMIN_EMAILS`, Microsoft, and Twilio server credentials.
3. `POST /api/platform/onboarding` with `{ "slug": "spin-marketing" }` as an allow-listed platform administrator.
4. The tenant is created in `provisioning` status with an immutable initial configuration version. Activation stays blocked until business identity, confirmed policies, Microsoft connectivity, SMS/MMS/voice capability, and payroll configuration are verified.
5. Authorized tenant administrators review the configuration at `/company/<tenant-id>` and use the integration health check.

See [docs/company-configuration.md](docs/company-configuration.md) for the status model, security boundaries, and provisioning blockers. Configuration files contain secret references such as `env:MICROSOFT_CLIENT_SECRET`, never live credentials.

## Documentation
- [docs/user-guide.md](docs/user-guide.md) — comprehensive user guide: sign-in, workspaces, configuration, roles, integrations, troubleshooting
- [docs/supabase-application-setup.md](docs/supabase-application-setup.md) — Supabase setup, migrations, auth, storage
- [docs/company-configuration.md](docs/company-configuration.md) — configuration schema, versioning, provisioning
- [docs/hrs-and-earned-wage-access.md](docs/hrs-and-earned-wage-access.md) and [docs/hrs-custodial-token-economics.md](docs/hrs-custodial-token-economics.md) — HRS architecture and boundaries
- [AGENTS.md](AGENTS.md) — current state and edit log for coding agents
- [diagnostics/](diagnostics/README.md) — verification reports

## Contract development and tests
Requires Python 3.12.

    python -m pip install -r contracts/requirements.txt
    vyper contracts/src/HrsToken.vy
    vyper contracts/src/HrsController.vy
    python -m pytest contracts/tests -q

The Vyper contract workflow compiles and runs local EVM tests on pull requests and pushes to `main`.

## Release status
The application has Supabase SSR/browser/admin client boundaries, email magic-link authentication, authenticated tenant onboarding, a tenant-isolated employer dashboard, a private document bucket with tenant-folder policies, versioned tenant configuration, configuration-driven policy/approval/timekeeping services, Microsoft Graph and Twilio clients, and HRS database posting primitives. The application migrations have not yet been applied to a real Supabase project because no project reference or credentials were supplied in the build session.

The Spin Marketing configuration is validated and provisionable but not operational: no real Microsoft Entra credentials, no purchased SMS/MMS/voice number, no verified payroll provider, and no confirmed Spin Marketing HR policies were supplied. The tenant therefore remains in provisioning status until those external requirements are satisfied.

The Vyper HRS token and idempotent mint/burn controller are in the repository with local EVM tests. They are not deployed or independently audited. The PostgreSQL HRS ledger is not yet connected to the chain. No live chain issuance, external market, swap, employee payout, or payroll disbursement is enabled. See `contracts/README.md` for the remaining controls and deployment gates.

Never put service-role keys, provider secrets, tax identifiers, bank details, private keys, seed phrases, or sensitive employee data in agent files or source control.
