# DIR-008 — Core functionality verification (V-005)

- **Date:** 2026-11-10
- **Directive:** PEOPLEOS-VERIFICATION-001, workstream V-005
- **Verdict:** PARTIAL — all features verified as implemented (interface + logic + persistence path + authz); live execution and data persistence BLOCKED on a configured database. One real defect found earlier this session (D-1 middleware500, fixed — see DIR-005).

Method per feature: interface present? logic implemented? persistence path? authorization enforced? errors handled? Live execution noted where possible.

## Feature matrix

| Feature | Interface | Logic implemented | Persistence path | Authz enforced | Live executed | Verdict |
|---|---|---|---|---|---|---|
| Workspace creation | `/setup` form (legal name, display name, timezone) | `POST /api/tenants` → Zod-validated, content-type/size checks, idempotent `requestKey` UUID | RPC `create_tenant_for_current_user` (migration 0005; grants `authenticated` only; audit event written per docs) | `401` if no user | No (DB) | IMPLEMENTED (static) |
| Dashboard | `/` renders workspace grid with status/role/employee count/timezone/legal name | reads `tenant_memberships`, `tenants`, `employees` count | Supabase tables via RLS | membership-scoped queries; no user → `/login` | Only the503 guard | IMPLEMENTED (static) |
| Company configuration page | `/company/[tenantId]` — readiness panels, operating context, identity/policy editor, agents, roles, integration table | full source read (197 lines) | active config from `tenant_config_versions` via hash-verified service | `notFound()` without membership; `company.configuration.read` gate (line 62); write/status gates passed to editor | No (DB) | IMPLEMENTED (static) |
| Settings persistence (publish) | "Publish configuration" button in `ConfigEditor` | `PATCH /api/company/[tenantId]/configuration` → `ConfigEditSchema` → `applyConfigEdit` → validate → hash → RPC `publish_tenant_config_version` (service-role only) | immutable version row + audit event | `company.configuration.write` via `loadTenantPrincipal` | No (DB) | IMPLEMENTED (static) |
| Roles & permissions | roles panel on company page; role badge on dashboard | `roleHasPermission` in `src/lib/company-config/access.ts`; roles come from active config `workforce.roles` | config document | enforced at page (`read`) and API (`write`/`status.manage`) layers | No | IMPLEMENTED (static) |
| Platform onboarding | API-only (`POST /api/platform/onboarding`) | allow-list from `PEOPLEOS_PLATFORM_ADMIN_EMAILS`; empty list → 403 "disabled"; non-allow-listed → 403; slug regex; `allowDraft: false` | `provisionTenantFromConfig` → tenant + initial version | platform allow-list (email) | No (DB) | IMPLEMENTED (static) |
| Storage | private bucket `peopleos-documents` (migration 0005) | policies: members read; owner/admin/manager insert+update; owner/admin delete; tenant-folder UUID validation helpers | `storage.objects` + `storage.buckets` (25MiB limit) | RLS policies + helper functions revoked from `public`/`anon` | No (DB) | IMPLEMENTED (static, migration source) |
| HRS boundaries | dashboard notice: not enabled from dashboard | HRS RPCs service-role-only (admin client); `hrs-*` libs tested (part of81 tests); no browser path to posting | ledger tables locked to anon/authenticated (migration 0002/0003) | RLS + revoke grants | n/a (gated by design) | ENFORCED (static + tests) |
| API endpoints (all11) | route files present for agents/context, auth/signout, company configuration/health/notifications/status, platform/onboarding, tenants, twilio webhooks ×2, auth/callback | each read or spot-checked this session; Zod/HttpError patterns consistent | as above | `authenticatedUser`/`loadTenantPrincipal`/allow-list per route | Partially — all exercised through the503 guard only | IMPLEMENTED (static) |
| Integration health | button in editor → `POST …/integrations/health` | route reads config refs, `envValue` fallbacks, provider clients | updates `tenant_integrations` rows (state/evidence/capabilities) | `company.configuration.write` (via same principal load — route source checked) | No (needs live creds) | IMPLEMENTED (static) |
| Twilio webhooks | `POST /api/webhooks/twilio`, `…/status` | HMAC-SHA1 signature validation against raw body + `TWILIO_AUTH_TOKEN` (per docs; routes read) | `tenant_messages` / consent tables | signature = authz | No (no live Twilio) | IMPLEMENTED (static) |

## Buttons/claims spot-checks (guide §4)

- "Publish configuration" → PATCH route exists and persists via RPC ✓
- "Run integration health check" → button `onClick={runHealthCheck}` → POST route exists ✓
- "Activate tenant"/"Suspend tenant" → buttons gated by `canManageStatus`; POST `/api/company/<id>/status` with `activate|suspend` ✓
- Policy dropdown `requires_confirmation` option exists in editor ✓

## Placeholder/mock scan

No hardcoded mock responses found in route handlers. Integration tests use mocked provider responses by design (documented in `docs/company-configuration.md`) — tests, not runtime placeholders.

## Residual risk

Everything above the guard line is statically verified but unexecuted against a real database. Persistence and RLS behavior rest on migration correctness (CI reportedly applies all six to a clean database — not re-run this session).
