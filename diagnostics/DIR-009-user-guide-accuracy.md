# DIR-009 — User guide accuracy (V-006)

- **Date:** 2026-11-10
- **Directive:** PEOPLEOS-VERIFICATION-001, workstream V-006 — walkthrough of all11 sections of `docs/user-guide.md`
- **Verdict:** PASS after corrections (2 stale env sections fixed; all other claims verified or classified)

## Section-by-section

| § | Claim checked against code | Result |
|---|---|---|
| 1 Sign-in | magic link, `/auth/callback`, sign-out button posts `/api/auth/signout` | PASS — matches `login/page.tsx`, `callback/route.ts`, `signout/route.ts` |
| 2 Workspace setup | fields (legal 2-200, display, timezone), idempotent request key, owner role, redirect home | PASS — `setup/tenant-form.tsx` + `api/tenants/route.ts` (Zod `uuid()` requestKey; RPC creates owner per migration docs) |
| 3 Dashboard | card fields (status, role, employee count, timezone, legal name, shortened ID), create-another link, services section, security notice | PASS — `src/app/page.tsx` |
| 4 Company config page | every panel/button: activation notice, integration readiness, operating context, identity/policy editor, publish, health check, activate/suspend, agents, roles, integration table; permission names `company.configuration.read/write`, `tenant.status.manage` | PASS — page + editor sources; permission strings verified in `access.ts` usage |
| 5 Roles | owner/administrator/manager/auditor; creator becomes owner | PASS — membership role enum in schema (`owner|administrator|manager|auditor`); creator = owner via `create_tenant_for_current_user` |
| 6 Platform ops | `PEOPLEOS_PLATFORM_ADMIN_EMAILS`, `POST /api/platform/onboarding {slug}`, provisioning status, readiness states `not_configured→configured→provisioned→verified→operational` | PASS — route source + `readiness.ts` state names |
| 7 Storage | bucket name, tenant-UUID path rule, permission tiers, 25MiB | PASS — migration 0005 lines143-175 |
| 8 HRS | no employee wallets, server-side only, no wage coupling, not live | PASS — consistent with `docs/hrs-*.md` and dashboard notice |
| 9 Troubleshooting | 503 row, env:sync row, login-loop row, memberships-error row, config-unavailable row | PASS after correction (below) |
| 10 Environment/secrets | manifest-based description — **stale** | CORRECTED (below) |
| 11 API surface | route table vs `src/app/api/**/route.ts` file list | PASS — all listed routes exist; no undocumented routes beyond table |

## Corrections applied (conclusive evidence)

1. **§9 troubleshooting rows (2):** old rows described the retired manifest flow (`MISSING NEXT_PUBLIC_SUPABASE_URL`, "env:sync exits 1 when KWallet entry absent"). Current `env:sync` never reads KWallet and only exits 1 on credential-like values. Replaced with accurate rows (503 = empty/unresolved `keyring`; sync-exit-1 = credential-like value in file).
2. **§10 environment and secrets:** rewrote to the single-file keyring model (`.env.local` authoritative; account-derived → `keyring`; launcher resolves at launch; manifest retired).

## Claims that remain untestable (documented, not errors)

- Actual email delivery, persistence round-trips, live health checks, webhook signature acceptance: BLOCKED on external prerequisites (DIR-006/007/008).

## Observed evidence vs inference

Observed: all source files cited above; guide text before/after.
Inference: none material — every PASS is backed by a named file/line read this session.
