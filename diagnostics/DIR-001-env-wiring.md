# DIR-001 — Environment wiring: manifest + KWallet sync

- **Date:** 2026-11-10
- **Directive:** "why doesn't the app just have a file that declares the total list of variables that are need to be secure and fucking that list you know would be all in kwallet under PEOPLEOS service"
- **Status:** Tooling complete; blocked on owner-supplied Supabase project URL

## What was built

| File | Purpose |
|---|---|
| `env.manifest.json` | Declares all 13 environment variables: name, required flag, KWallet entry name, description. Also lists 2 wallet-only entries the app does not consume. Contains **no values**. |
| `scripts/sync-env.mjs` | Implements `npm run env:sync`. For each manifest variable it reads KWallet wallet `kdewallet`, folder `PEOPLEOS`, entry `<walletEntry>` (default = variable name), and writes the value into `.env.local`. Prints a status table (names, entry names, lengths only — never values). Exits 1 if any required entry is missing. Also warns if a manifest variable is absent from `.env.example` (drift check). |
| `package.json` | `"env:sync": "node scripts/sync-env.mjs"` |

## KWallet mapping (folder `PEOPLEOS`)

| KWallet entry | Env variable | Required | Present (2026-11-10) |
|---|---|---|---|
| `SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` | yes | **no** |
| `DEFAULT_SUPABASE_API` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | yes — `sb_publishable_…`, 46 chars |
| `DEFAULT_SECRET_KEY` | `SUPABASE_SERVICE_ROLE_KEY` | yes | yes — `sb_secret_…`, 41 chars |
| (same name) | `TWILIO_*` (5 vars) | no | no |
| (same name) | `MICROSOFT_*` (3 vars) | no | no |
| (same name) | `PEOPLEOS_PLATFORM_ADMIN_EMAILS` | no | no |
| (same name) | `PAYROLL_PROVIDER_SECRET` | no | no |
| `DATABASE_PASSWORD` | — (wallet-only) | n/a | yes |
| `JWT_SIGNING_KEY` | — (wallet-only) | n/a | yes — UUID format |

## Evidence — `npm run env:sync` run (2026-11-10)

```
KWallet folder: PEOPLEOS (wallet: kdewallet)

MISSING  NEXT_PUBLIC_SUPABASE_URL          SUPABASE_URL                    required — add to KWallet
ok       NEXT_PUBLIC_SUPABASE_ANON_KEY     DEFAULT_SUPABASE_API            len=46
ok       SUPABASE_SERVICE_ROLE_KEY         DEFAULT_SECRET_KEY              len=41
missing  TWILIO_ACCOUNT_SID                TWILIO_ACCOUNT_SID              optional
missing  TWILIO_AUTH_TOKEN                 TWILIO_AUTH_TOKEN               optional
missing  TWILIO_PHONE_NUMBER               TWILIO_PHONE_NUMBER             optional
missing  TWILIO_MESSAGING_SERVICE_SID      TWILIO_MESSAGING_SERVICE_SID    optional
missing  TWILIO_WEBHOOK_BASE_URL           TWILIO_WEBHOOK_BASE_URL         optional
missing  MICROSOFT_CLIENT_ID               MICROSOFT_CLIENT_ID             optional
missing  MICROSOFT_CLIENT_SECRET           MICROSOFT_CLIENT_SECRET         optional
missing  MICROSOFT_TENANT_ID               MICROSOFT_TENANT_ID             optional
missing  PEOPLEOS_PLATFORM_ADMIN_EMAILS    PEOPLEOS_PLATFORM_ADMIN_EMAILS  optional
missing  PAYROLL_PROVIDER_SECRET           PAYROLL_PROVIDER_SECRET         optional
present  (wallet only: DATABASE_PASSWORD)  DATABASE_PASSWORD               Supabase database password; used by Supabase, not read by this app
present  (wallet only: JWT_SIGNING_KEY)    JWT_SIGNING_KEY                 Supabase JWT secret; used by Supabase, not read by this app

Wrote /home/uber/Git/people-os/.env.local
FAIL: required entries missing from KWallet. Add them, then re-run.
exit=1
```

Post-run `.env.local` state (lengths only):

```
NEXT_PUBLIC_SUPABASE_URL len=0
NEXT_PUBLIC_SUPABASE_ANON_KEY len=46
SUPABASE_SERVICE_ROLE_KEY len=41
(all optional vars len=0)
```

## Failure modes handled

- `kwallet-query` exits 0 even on failure — the script treats stdout containing `Failed to read` / `does not exist` as a missing entry.
- Existing `.env.local` values are preserved when an entry is missing from the wallet (but a missing **required** entry still fails the run).
- Missing variables are appended to `.env.local`; comments and unknown lines are preserved.

## Open items (owner action)

1. Store the Supabase project URL as KWallet entry `SUPABASE_URL` in folder `PEOPLEOS`.
2. Re-run `npm run env:sync` — expect exit 0 with all three required vars `ok`.
3. Apply the six Supabase migrations (`docs/supabase-application-setup.md`).

**No hunting:** agents must not search the disk or other projects for the URL. Only the owner supplies it.
