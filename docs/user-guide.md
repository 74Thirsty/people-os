# PeopleOS User Guide

PeopleOS is a phone-first, workforce operating system. Employees interact through a company phone number using SMS, voice calls, and smartphone dictation. Employers manage everything through this web command center — no employee app or employee portal is required.

This guide covers everything a tenant owner, administrator, or platform operator needs. For deep technical setup, see the linked references at the end.

---

## 1. Signing in

1. Go to the app URL (locally: http://localhost:3000). Unauthenticated visitors are redirected to **`/login`**.
2. Enter your work email and submit. PeopleOS uses **Supabase Auth email magic links** — no passwords.
3. Open the email and follow the one-time sign-in link. It lands on `/auth/callback`, which establishes your session and redirects you into the app.
4. To leave, use **Sign out** in the top bar.

Requirements: the Supabase project must be configured (Site URL + `/auth/callback` in the redirect allow-list) and all database migrations applied. See [Troubleshooting](#9-troubleshooting) if sign-in does not complete.

## 2. First run: creating a company workspace

If your account has no workspace yet, you are sent to **`/setup`**:

1. **Legal business name** (required, 2–200 characters)
2. **Display name** (optional — defaults to the legal name)
3. **Business time zone** (pick from the list; default Central)

Submitting calls `POST /api/tenants`, which creates the tenant and your membership as **owner** in one transaction. The request is idempotent — retries with the same request key cannot create duplicates. You are returned to the dashboard.

You can create additional workspaces later from **"Create another workspace"** on the dashboard.

## 3. Dashboard (home)

The dashboard shows every workspace you belong to:

| Field | Meaning |
|---|---|
| Status | Tenant lifecycle status (e.g. `provisioning`, `active`) |
| Role | Your membership role in that workspace |
| Employees | Live count of employee records in the database — not sample data |
| Time zone | The tenant's configured IANA time zone |
| Legal name | Registered legal entity name |
| Tenant ID | Shortened UUID; full ID appears in the URL of workspace pages |

From each card, **Company configuration** opens `/company/<tenant-id>`.

The dashboard also shows which platform services are connected (Supabase Auth, PostgreSQL + RLS, private document storage) and a standing security boundary notice: payroll, compensation changes, HRS minting, clock-event consumption, and employee lifecycle actions are **not** enabled from this dashboard — they require their own authorization and audit workflows.

## 4. Company configuration page

**`/company/<tenant-id>`** is the command center for one company. You must be a member of that tenant; non-members get a 404. Viewing requires the `company.configuration.read` permission; editing requires `company.configuration.write`; activate/suspend requires `tenant.status.manage`.

### Activation notice
If the tenant cannot go live yet, a notice lists every outstanding **activation requirement** (business identity, policy confirmation, Microsoft connectivity, SMS/MMS/voice capability, payroll verification). Each item disappears as it is satisfied.

### Integration readiness
- **Microsoft 365 / Entra / Graph** — current state and evidence (or what's missing)
- **SMS / MMS / voice** (Twilio) — current state, verified number, capabilities
- **Enforceable HR policies** — how many policies are enforceable vs. awaiting company confirmation

### Operating context
Read-only summary of the active configuration: time zone, current pay period (start → end, cutoff), workweek start day, overtime threshold, currency, and live-payroll status. HRS schedules shown here are **time accounting only — never treated as earned wages**.

### Business identity and policy controls
The configuration editor lets authorized users:
- Edit **operating name, description, website, business contact email, business contact telephone**
- Review every **HR policy** with its status (`approved`, `requires_confirmation`, …) and source status (`verified`, `inferred`, `example`, …)
- **Publish configuration** — saves edits as a new immutable configuration version (visible as "Configuration vN" in the header). Publication goes through a service-role-only database function that supersedes the previous version and writes an audit event.
- **Run integration health check** — performs live checks against Microsoft and Twilio and records state/evidence
- **Activate tenant / Suspend tenant** — lifecycle controls for users with status-management permission

> Inferred policies cannot silently block or auto-approve work: they evaluate as *advisory* until the company confirms them.

### Agents resolved from this configuration
Shows each configured agent: name, purpose, enabled state, channels (e.g. sms), policy access count, and which actions require approval. Agents are scoped to exactly one tenant configuration — there is no global instruction fallback.

### Workforce roles and permissions
Lists the company's roles (e.g. owner, administrator, manager, auditor) with permission counts and data-access levels for employee records and compensation.

### Integration status detail
Table of stored provider records: provider, state, phone number, last check time, evidence. **Configured values are references only** — secrets stay in the server environment or KWallet, never in configuration files or Git.

## 5. Roles

| Role | Typical powers |
|---|---|
| **Owner** | Full control: configuration edits, status management, approvals |
| **Administrator** | Day-to-day management, approvals per configuration |
| **Manager** | Operational workflows within assigned permissions |
| **Auditor** | Read-oriented access per configuration |

Exact permissions are defined per company in `workforce.roles` inside the active configuration and enforced by the application (role → permission checks) and by database row-level security.

The person who creates a workspace becomes its **owner**. Owners can add members after setup.

## 6. Platform operations (advanced)

Platform operators provision repository-defined companies:

1. Set `PEOPLEOS_PLATFORM_ADMIN_EMAILS` to a comma-separated allow-list of operator emails (plus Microsoft/Twilio server credentials as needed).
2. As an allow-listed operator, call:

   ```
   POST /api/platform/onboarding
   { "slug": "<tenant-config-slug>" }
   ```

3. The tenant is created in **`provisioning`** status with an immutable initial configuration version. Draft configurations are refused.
4. A tenant owner/administrator then signs in, reviews `/company/<tenant-id>`, confirms policies, and runs the integration health check.
5. **Activation** succeeds only when business identity, all policies, Microsoft connectivity, SMS + MMS + voice capability, and payroll verification are complete.

Readiness states: `not_configured` → `configured` → `provisioned` → `verified` → `operational` (or `error`).

## 7. Documents and storage

- Private bucket: **`peopleos-documents`**, scoped per tenant.
- Object paths must start with the tenant UUID: `<tenant-uuid>/employees/<employee-uuid>/document.pdf`
- Members can read their tenant's objects; owner/administrator/manager can upload and update; owner/administrator can delete.
- Maximum object size: 25 MiB. The bucket is never public.

## 8. HRS (schedule accounting) — boundaries

HRS is PeopleOS's custodial schedule-accounting token: 1 HRS = 1 scheduled hour. Important boundaries:

- **Employees have no wallet, keys, transfers, or withdrawals.** PeopleOS controls all custody.
- HRS postings are server-side only — never called from the browser or dashboard.
- HRS quantity and valuation are **never** inputs to wage calculations. Verified time is paid from the payroll ledger, independently.
- No live minting, redemption, payout, or external token operation is enabled today.

Details: `docs/hrs-and-earned-wage-access.md`, `docs/hrs-custodial-token-economics.md`.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Plain text: **"PeopleOS is not configured. Contact the system administrator."** (HTTP 503) on every page | `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is empty or still the unresolved `keyring` marker | Fill the KWallet entry (folder `PEOPLEOS`, entry name = exact variable name), restart `npm run dev` |
| `npm run env:sync` exits 1 | A variable in the file holds a credential-looking value instead of the `keyring` marker | Set that variable's value to the literal string `keyring`; move the real value into KWallet |
| You are bounced to `/login` but the magic link fails or loops | Supabase Auth URL/redirect not configured, or migrations not applied | Set Auth Site URL and allow `http://localhost:3000/auth/callback`; apply all six migrations (`docs/supabase-application-setup.md`). |
| Error page: **"Unable to load tenant memberships"** (or similar database errors) | Migrations not applied to this Supabase project | Apply migrations `202611090001`–`202611100001` in order. |
| Company page shows **"Configuration unavailable"** | Tenant has no active provisioned configuration | Provision the tenant (platform onboarding, section 6). |
| **"Activation requirements outstanding"** list never shrinks | External blockers (credentials, verified number, confirmed policies, payroll) | See `docs/company-configuration.md` — current blockers. |
| Email sign-in never arrives | Supabase Auth email not configured / rate-limited | Check Supabase Auth settings and project email limits. |
| Server won't start after editing `.env.local` | `NEXT_PUBLIC_*` values are read at startup/build | Restart `npm run dev` (or rebuild). |

## 10. Environment and secrets (operators)

- **`.env.local` is THE authoritative list** of every variable — `npm run env:sync` scans the codebase and keeps it complete. Nothing else is a list.
- **Sensitive** (anything obtained by logging into an account): value is the literal marker `keyring`. Real values live in KWallet wallet `kdewallet`, folder `PEOPLEOS`, entry = exact variable name.
- **Non-sensitive settings** carry their real values directly in `.env.local`.
- `npm run dev` / `build` / `start` run through `scripts/with-keyring.mjs`, which resolves `keyring` markers from KWallet at launch — real secrets never touch disk.
- `.env.local` is gitignored. Never commit it. Never put a real secret in any tracked file.
- The service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is server-only — never expose it to browsers, employees, or agents.

## 11. API surface (reference)

| Route | Purpose |
|---|---|
| `POST /api/auth/signout` | Sign out |
| `GET /auth/callback` | Magic-link session exchange |
| `POST /api/tenants` | Create workspace (owner, idempotent) |
| `GET/POST /api/tenants` list | Tenant membership reads |
| `GET/POST /api/company/<id>/configuration` | Read / publish configuration versions |
| `POST /api/company/<id>/integrations/health` | Run integration health check |
| `GET/POST /api/company/<id>/status` | Tenant lifecycle (activate/suspend) |
| `GET/POST /api/company/<id>/notifications` | Notification channel management |
| `POST /api/platform/onboarding` | Provision a tenant from a repository slug (allow-listed operators) |
| `POST /api/webhooks/twilio`, `.../status` | Inbound SMS and delivery-status webhooks (HMAC-verified) |
| `GET /api/agents/<agentId>/context` | Tenant-scoped agent context resolution |

All company routes enforce tenant membership; HRS posting RPCs are service-role-only and not exposed to the browser.

---

## Further reading

- `README.md` — project overview, setup, validation
- `docs/supabase-application-setup.md` — Supabase project, migrations, auth, storage
- `docs/company-configuration.md` — configuration schema, versioning, provisioning, external blockers
- `docs/hrs-and-earned-wage-access.md` — HRS architecture
- `docs/hrs-custodial-token-economics.md` — valuation and economics boundaries
