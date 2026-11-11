# DIR-007 — Authentication verification (V-004)

- **Date:** 2026-11-10
- **Directive:** PEOPLEOS-VERIFICATION-001, workstream V-004
- **Verdict:** PARTIAL — guard rails and redirect logic verified live; magic-link sign-in BLOCKED (no configured Supabase project)

## Live behavior (observed with dev server)

| Request | Result | Meaning |
|---|---|---|
| `GET /` (unauthenticated, no session) | `503` + `PeopleOS is not configured. Contact the system administrator.` | Expected guard: Supabase URL/key unresolved (`keyring` unbacked) — see DIR-005 D-1 |
| `GET /login` | `503` same body | Guard applies to login too by design (`middleware` matcher covers all non-static, non-`api/` paths) |

Once a real URL + anon key resolve, the middleware logic (static inspection of `src/middleware.ts`):

- no user + not `/login` + not `/auth/callback` → **redirect to `/login`** (observed code path, lines 30-35)
- user on `/login` → **redirect to `/`** (lines 36-41)
- matcher excludes `_next/static`, `_next/image`, `favicon.ico`, `api/*`

## Component-by-component (static)

| Feature | Implementation | Evidence |
|---|---|---|
| Sign-in | `src/app/login/page.tsx` + `login-form` → Supabase magic link; `src/app/auth/callback/route.ts` exchanges `code` for session, redirects `/` on success, `/login?error=auth_callback` on failure | route source read |
| Sign-out | `POST /api/auth/signout` → `auth.signOut()` then `303 → /login`; top-bar form posts to it | route source read |
| Session persistence | cookie-backed SSR client (`@supabase/ssr`) with `getAll`/`setAll` cookie methods in middleware | middleware source read |
| Protected routes | every page calls `auth.getUser()` and `redirect("/login")` when absent (home, setup, company pages); API routes return `401` (e.g. `api/tenants` line 23) | sources read |
| Unauthorized access (cross-tenant) | company page: no membership → `notFound()`; API: `loadTenantPrincipal(tenantId, permission)` throws for non-members | `src/app/company/[tenantId]/page.tsx:33-36,62`; http helper usage in routes |
| Invalid credentials | not applicable — passwordless magic links; failure surfaces as callback error redirect | — |
| Expired sessions | Supabase SSR invalidates server-side; next `getUser()` fails → redirect to `/login` (mechanism: `getUser` on every request) | middleware + page sources |
| Account/workspace association | membership rows in `tenant_memberships` keyed by `user_id`; no membership → `/setup` | `src/app/page.tsx:13-16` |

## Discrepancies vs user guide

- Guide §1 says unauthenticated visitors are redirected to `/login` — **true only when Supabase is configured**; otherwise the503 guard answers first. Guide troubleshooting table documents the503. No correction needed.
- No other discrepancies found in §1/§9 claims.

## BLOCKED items (external prerequisite, not defects)

- Actual magic-link email delivery, session cookie round-trip, and callback exchange require a configured project + applied migrations. Not runnable this session.

## Observed evidence vs inference

Observed: HTTP results above; route/middleware sources.
Inference: expired-session and magic-link flows follow Supabase SSR semantics as coded — not executed.
