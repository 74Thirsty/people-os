# DIR-006 — Supabase operational verification (V-003)

- **Date:** 2026-11-10
- **Directive:** PEOPLEOS-VERIFICATION-001, workstream V-003
- **Verdict:** PARTIAL — code and schema paths verified statically; live database connectivity BLOCKED (no configured project URL)

## Inspected

**Client initialization (observed):**
- `src/lib/supabase/server.ts` — reads `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`, cookie-backed SSR client
- `src/lib/supabase/browser.ts` — same two vars, browser client
- `src/lib/supabase/admin.ts` — `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, server-only

**Key selection:** publishable/anon key (`sb_publishable_…`,46 chars) for user-facing clients; secret key (`sb_secret_…`, 41 chars) for the admin client. Both match Supabase's new key-type conventions — correct types for their roles (inference from format; not re-validated against Supabase docs this session).

**Migration inventory (observed):** exactly six files in `supabase/migrations/`, matching `docs/supabase-application-setup.md` order (`202611090001` → `202611100001`). Schema objects referenced by code were traced to them: `create_tenant_for_current_user` (0005, granted `authenticated` only), storage bucket `peopleos-documents` + tenant-scoped policies (0005), `publish_tenant_config_version` (0001), `tenant_integrations`/`tenant_messages` (0001).

**Auth configuration:** `supabase/config.toml` (local-dev config) sets `site_url = "http://localhost:3000"` and redirect `http://localhost:3000/auth/callback` — matches the guide. Live Supabase Auth settings for a hosted project cannot be inspected (no project URL configured).

**Live connectivity:** BLOCKED. `NEXT_PUBLIC_SUPABASE_URL` is `keyring` and its KWallet entry holds no value yet (owner populates at owner's discretion). No REST/auth query was possible. Not classified as an application defect.

## The documented HTTP 401 (from DIR-003, prior session)

Cause classification: **(1) incorrect project URL** — the only Supabase URL present on disk at the time belonged to a different local project, and the wallet keys were rejected by it with `401 Invalid API key` and the platform hint "might be owned by another Supabase project." Not a key-type error, not an auth-configuration error, not a permissions error. The correct project URL was simply never configured. DIR-003 holds the sanitized evidence.

## Remaining external prerequisites

- Owner-supplied project URL in KWallet (`NEXT_PUBLIC_SUPABASE_URL`)
- Applying the six migrations to that project (`docs/supabase-application-setup.md`)

## Observed evidence vs inference

Observed: source contents, migration file list, config.toml, prior sanitized401 body.
Inference: key-type correctness; that migrations are internally consistent (CI reportedly runs them on a clean database — not re-run this session).
