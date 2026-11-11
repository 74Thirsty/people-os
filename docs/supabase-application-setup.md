# PeopleOS Supabase application integration

## Runtime configuration

Set these values in the local environment and deployment environment:

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: publishable/anon key. Safe for browser use only with RLS enabled.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only secret. Never prefix it with `NEXT_PUBLIC_`; never send it to a browser or agent.

The app uses Supabase Auth email magic links, cookie-backed SSR sessions, PostgreSQL tenant membership, and a private Storage bucket. The service-role client is isolated in `src/lib/supabase/admin.ts` for trusted server workflows only.

## Apply migrations

The migration order is:

1. `202611090001_initial_tenant_foundation.sql`
2. `202611090002_hrs_ledger.sql`
3. `202611090003_custodial_hrs.sql`
4. `202611090004_hrs_atomic_posting.sql`
5. `202611090005_supabase_application_setup.sql`
6. `202611100001_company_configuration.sql`

For a new Supabase project, link the project with the Supabase CLI and apply migrations after reviewing the target project. CI also starts an isolated local Supabase stack, applies all six migrations from a clean database, and runs database lint before changes are accepted. Do not apply these foundation migrations to an existing populated database without a schema and data compatibility review.

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Configure the Supabase Auth Site URL and redirect allow-list for the deployed PeopleOS URL plus `/auth/callback`. For local development, allow `http://localhost:3000/auth/callback`.

## Initial tenant setup

1. An administrator signs in through the email magic-link flow.
2. A user without a tenant membership is directed to workspace setup.
3. The authenticated database identity creates a tenant and receives the owner role in one transaction.
4. A request UUID makes a retry of the same create request idempotent.
5. The tenant creation is recorded in `audit_events`.

Tenant membership and employee reads remain protected by RLS. HRS wallet, token-ledger, and valuation tables remain unavailable to anon/authenticated clients. HRS posting RPCs remain service-role-only.

## Company configuration and integrations

Tenant configuration is stored as immutable snapshots in `tenant_config_versions`. Exactly one version may be active per tenant. Publication is performed only through the service-role-only `publish_tenant_config_version` function, which supersedes the prior active version, writes the new snapshot, and records an audit event in one transaction.

`tenant_integrations` stores provider state and credential **references** only. `tenant_messaging_contacts` stores per-tenant SMS consent, and `tenant_messages` stores inbound/delivery records. A provisioned phone number is unique across tenants so inbound messages cannot be routed across company boundaries.

Apply migration 6 before using `/company/<tenant-id>`, `/api/company/*`, `/api/platform/onboarding`, or the Twilio webhooks. Configure `PEOPLEOS_PLATFORM_ADMIN_EMAILS`, `MICROSOFT_*`, `TWILIO_*`, and `TWILIO_WEBHOOK_BASE_URL` in the deployment environment. See [company-configuration.md](company-configuration.md).

## Storage

The private `peopleos-documents` bucket is tenant-folder scoped. Object paths must start with the tenant UUID, for example:

`<tenant-uuid>/employees/<employee-uuid>/document.pdf`

Members can read their tenant's objects; owner/administrator/manager roles can upload and update; owner/administrator roles can delete. The bucket is private and limited to 25 MiB per object.

## HRS production gate

The application integration does not activate HRS posting. Before any schedule mint or clock consumption is exposed, implement real schedule authorization, employee identity verification, signed source-event validation, replay protection, tenant role checks, and KMS/HSM-backed key-reference resolution. Do not use a placeholder signing-key reference or fake clock verifier. The HRS RPCs are not called by the dashboard or browser.

## Dependency and CI controls

- Commit `package-lock.json`; production and CI installs use `npm ci`.
- CI fails on high and critical npm audit findings.
- CI applies the complete migration chain to an isolated local Supabase/PostgreSQL instance and runs `supabase db lint`.
- Dependency changes must update `package.json` and `package-lock.json` together. Use `npm run lockfile:refresh` to regenerate the lockfile.
