# DIR-005 — Environment & secret handling (V-002)

- **Date:** 2026-11-10
- **Directive:** PEOPLEOS-VERIFICATION-001, workstream V-002; verifies the keyring single-registry model
- **Verdict:** PASS (after two defect fixes recorded below)

## Model under test

`.env.local` is the only environment file and the authoritative list of all13 variables. Sensitive values (anything obtained by logging into an account) hold the literal marker `keyring`; real values live in KWallet wallet `kdewallet`, folder `PEOPLEOS`, entry = exact variable name. `scripts/with-keyring.mjs` resolves markers at launch. `npm run env:sync` scans code for variable usage and keeps `.env.local` complete.

## Checks performed

| Check | Method | Result |
|---|---|---|
| `.env.example` has names, no real secrets | Read file | PASS — only `keyring` markers and empty settings |
| `env:sync` performs documented behavior | Ran `npm run env:sync` | PASS — exit 0;13 code vars =13 env-file vars;0 appended; values never printed |
| KWallet integration functional | Launcher smoke test: `node scripts/with-keyring.mjs node -e "..."` printing only state | PASS — `NEXT_PUBLIC_SUPABASE_ANON_KEY=resolved len=46`, `SUPABASE_SERVICE_ROLE_KEY=resolved len=41`; no value printed |
| `.env.local` excluded from Git | Read `.gitignore` (git commands prohibited by directive) | PASS — `.gitignore:6` is `.env.*`; `.env.local` matches; tracked-file scan (grep across repo excluding `.env.*`) found zero real credential values |
| No credentials in tracked files, logs, diagnostics, artifacts | Grep for the actual wallet values (46-char/41-char keys) across all repo files | PASS — zero matches outside the gitignored `.env.local` (which now holds only `keyring` markers; matches checked again after keyring migration: zero repo-wide) |
| Missing/invalid credentials produce understandable errors | Observed runtime (DIR-007): unresolved `keyring` → HTTP 503 with the documented plain-text message | PASS after defect fix D-1 |
| Sync does not silently overwrite settings | Code inspection: `sync-env.mjs` appends only when a variable is absent; never rewrites existing values; only fails on credential-like values | PASS |
| One-file rule | `sync-env.mjs` no longer reads or writes `.env.example` (defect D-2 fix) | PASS |

## Defects found and fixed (retested)

**D-1 (P1) — unresolved `keyring` crashed the app with HTTP 500.**
- Evidence: before fix, `GET /` and `GET /login` returned `http=500`; dev log pointed at `src/middleware.ts:15` (`createServerClient` received the literal string `keyring`).
- Root cause: middleware's not-configured guard tested only falsy values; `keyring` is truthy, so the guard passed and the client constructor threw.
- Fix: `src/middleware.ts` guard now also treats `url === "keyring" || key === "keyring"` as not configured (same clean503 response). Minimal, no behavior change when real values are present.
- Retest: `GET /` → `http=503` + `PeopleOS is not configured. Contact the system administrator.`; `typecheck` exit 0; `eslint src/middleware.ts` exit 0.

**D-2 (P3) — `env:sync` managed `.env.example` and emitted a bogus `GET` variable.**
- Evidence: `env:sync` appended `GET=` to `.env.local`; source was pattern `\?\?\s*"([A-Z]...)"` matching `init?.method ?? "GET"` in `integrations.test.ts`, unioned through `.env.example`.
- Fix: replaced that pattern with `envVar\s*\?\?\s*"..."`; script now reads/writes `.env.local` only; removed `GET=` from both files.
- Retest: `env:sync` exit 0, `code vars:13 env file vars:14→13`, `appended:0`, `grep '^GET='` →0 in both files.

## Sanitized configuration state (names and states only)

- `keyring` (11): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_SECRET`, `PAYROLL_PROVIDER_SECRET`
- empty settings (2): `TWILIO_WEBHOOK_BASE_URL`, `PEOPLEOS_PLATFORM_ADMIN_EMAILS`
- KWallet `PEOPLEOS` entries observed present (names only): the11 above + legacy `DATABASE_PASSWORD`, `JWT_SIGNING_KEY`, `DEFAULT_SUPABASE_API`, `DEFAULT_SECRET_KEY`
- Launcher-resolved lengths: anon key 46, service key 41 (values never printed)

Note: whether individual KWallet entries hold values is owner-controlled and is not treated as a defect here; the launcher skips unresolved markers silently by design.

## Open items

None for this workstream.
