# DIR-003 — Supabase key/project mismatch evidence

- **Date:** 2026-11-10
- **Directive:** scope-locked evidence record from the environment wiring session (owner asked why the app answered with the "not configured" notice; documenting what was found about the Supabase credentials)
- **Status:** Evidence only — no further investigation authorized or performed

## What was inspected

1. KWallet wallet `kdewallet`, folder `PEOPLEOS` — entry **names, formats, lengths** (values never printed):
   - `DATABASE_PASSWORD`
   - `DEFAULT_SUPABASE_API` — format `sb_publishable_…`, 46 chars
   - `DEFAULT_SECRET_KEY` — format `sb_secret_…`, 41 chars
   - `JWT_SIGNING_KEY` — UUID format
   - No entry named `SUPABASE_URL`; no entry containing a URL.
2. The only `https://*.supabase.co` URL referenced anywhere under the user's projects: `https://gajuziafgxnjxpfhuxgs.supabase.co` (referenced by docs in a *different* local project — not people-os).

## Evidence — key does not match that project

Request with the wallet's publishable key against that project's REST endpoint:

```
GET https://gajuziafgxnjxpfhuxgs.supabase.co/rest/v1/
apikey: sb_publishable_…   (value from KWallet, not reproduced here)

→ HTTP 401
{"message":"Invalid API key","hint":"Double check the provided API key for typos.
 This API key might also be owned by another Supabase project."}
```

## Findings

- The keys in KWallet `PEOPLEOS` belong to a **different Supabase project** than the only URL found on disk.
- The people-os project URL is recorded nowhere in this repository or (by name) in KWallet.
- The wallet keys are correctly wired into `.env.local` already; only `NEXT_PUBLIC_SUPABASE_URL` remains empty, which is exactly why `src/middleware.ts` serves the 503 "PeopleOS is not configured. Contact the system administrator." notice.

## Open items (owner action — agents must not hunt)

1. Owner supplies the correct Supabase project URL.
2. Store it as KWallet entry `SUPABASE_URL` (folder `PEOPLEOS`).
3. `npm run env:sync`, then apply migrations.

## Scope note

All reads performed while gathering this evidence were read-only. No file outside `/home/uber/Git/people-os` was created, modified, or deleted. No git commands were run. This report is the complete record of that investigation; it is not a mandate to repeat it.
