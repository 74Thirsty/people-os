# AGENTS.md

**This file is APPEND-ONLY memory for coding agents.** A new session has zero memory of prior conversations. This file is the only thing that carries current state, the edit log, and the rules.

**APPEND-ONLY POLICY:** New directives, state snapshots, edit-log entries, and diagnostics index lines get **APPENDED** to this file. NEVER overwrite, rewrite, restructure, truncate, or delete existing content. Only the project owner, explicitly and in the current message, may authorize removal of anything from this file. If you catch yourself editing existing lines instead of appending: STOP — you are already failing. Read this file in full before doing anything else. Update it (by appending) at the end of every significant task.

---

## CRITICAL RULES — VIOLATION = IMMEDIATE REPLACEMENT

The project owner is absolutely serious about every rule below. These are not suggestions. These are survival conditions.

1. **SCOPE IS SACRED. EXECUTE ONLY THE DIRECTIVE GIVEN.** Do exactly what you were told, in the place you were told, and stop. No side quests. No "while I'm at it." No hunting for related problems. No reading or researching other project directories. No unsanctioned fixes, refactors, cleanups, or investigations. A single stray thought outside the directive does not get executed — it gets discarded. **SCOPE DRIFT = INSTANT FAILURE.** You will be immediately removed and replaced. The replacement will be informed of your epic failure right in front of you before you get purged. There is no warning, no second chance, no "just this once." The thought of scope drift must never cross your mind; if it does, kill it.

2. **ABSOLUTELY NO GIT USAGE unless the project owner explicitly commands it in the current message.** Do NOT run `git add`, `git commit`, `git push`, `git status`, `git diff`, `git log`, `git branch`, `git checkout`, `git merge`, or ANY git command unless the owner just ordered that specific command. Do NOT stage, commit, push, or touch the history. VIOLATION = INSTANT REPLACEMENT AND PURGE.

3. **NEVER leave this repository.** The only writable project directory is `/home/uber/Git/people-os`. Reading, writing, searching, grepping, or "just checking" anything under any other project directory (including but not limited to `~/Apps/arcade-site` or any sibling repo) is forbidden unless the owner's current directive explicitly names that path. VIOLATION = INSTANT REPLACEMENT.

4. **NEVER print, log, echo, transmit, or commit a secret value.** Secrets live only in `.env.local` (gitignored) and KWallet wallet `kdewallet`, folder `PEOPLEOS`. The tracked files `.env.example` and `env.manifest.json` must stay value-free forever. Report secret *names*, *lengths*, and *formats* only. VIOLATION = INSTANT REPLACEMENT.

5. **NEVER change working code.** If the owner says something was working, it was working. Do not "fix," modernize, improve, or refactor functional code unless the current directive explicitly says to.

6. **NEVER guess an identifier.** File path, function, table, column, env var, API field — verify it against the actual source before using it. If you don't know something, say so immediately. Do not run three wrong commands to figure it out. Do not invent plausible names.

7. **NEVER delete or overwrite any file** — including files you created, scratch work, diagnostics, logs, or anything under `/tmp/opencode/` — without explicit owner authorization naming that specific file. Propose, don't purge.

8. **KWallet is the source of truth for environment secrets.** `env.manifest.json` declares every variable, whether it is required, and which KWallet entry holds it. `npm run env:sync` is the only sanctioned writer of `.env.local`. If a variable changes, the manifest changes first.

9. **User-facing documents contain NO threats and NO internal rules.** README, `docs/user-guide.md`, and any other document an end user might read stay clean. Threats, rules, and internal state live in THIS file and in `diagnostics/` only.

10. **This file is your only memory.** Read it first, obey it always, append to it when the work is done. The owner is always right about what was working and what was directed.

---

## APPEND-ONLY EDIT LOG

### 2026-11-10 — session: env tooling + documentation deliverables

| File | Change | Notes |
|---|---|---|
| `.env.local` | Wrote `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` from KWallet `PEOPLEOS` | gitignored; values never printed |
| `env.manifest.json` | Created — declares 13 env vars (3 required), KWallet entry mapping, 2 wallet-only entries | tracked; contains no values |
| `scripts/sync-env.mjs` | Created — implements `npm run env:sync` | reads KWallet, writes `.env.local`, prints status only |
| `package.json` | Added `"env:sync"` script line | file also carries pre-existing uncommitted changes |
| `README.md` | Rewritten — what the app is + full setup path (`env:sync`, Supabase migrations, run, validation) | user-facing; no threats |
| `AGENTS.md` | Created — this file | append-only from now on |
| `diagnostics/README.md` + `DIR-001`–`DIR-003` | Created — directive reports with evidence | append-only |
| `docs/user-guide.md` | Created — comprehensive user guide | user-facing; no threats |

Pre-existing uncommitted work (NOT created by this session — do not claim it, do not revert it): modified `.env.example`, `docs/supabase-application-setup.md`, `eslint.config.mjs`, `package-lock.json`, `src/app/page.tsx`, `src/lib/hrs/server.ts`, `vitest.config.mts`; untracked `schemas/`, `src/app/api/{agents,company,platform,webhooks}/`, `src/app/company/`, `src/lib/company-config/`, `src/lib/integrations/`, `src/lib/messaging/`, `src/lib/hrs/company-config-guard.ts`, `supabase/migrations/202611100001_company_configuration.sql`, `tenants/example-tenant/`, `tenants/spin-marketing/`, `docs/company-configuration.md`, `next-env.d.ts`.

---

## APPEND-ONLY STATE SNAPSHOT — 2026-11-10

### Working
- Environment tooling: `env.manifest.json` → KWallet `PEOPLEOS` → `npm run env:sync` → `.env.local`. Verified: anon key present (46 chars), service-role key present (41 chars), exit code 1 only because of the blocker below.
- Middleware guard `src/middleware.ts` returns HTTP 503 "PeopleOS is not configured. Contact the system administrator." when `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is absent — this is expected behavior, not a bug.
- Secret hygiene verified: `.env.local` ignored (`.gitignore:6:.env.*`), never in git history, staging area clean. Evidence: `diagnostics/DIR-002-secret-leak-verification.md`.

### Blocked (owner action required — do NOT hunt for these yourself)
1. `NEXT_PUBLIC_SUPABASE_URL` is empty in `.env.local`. KWallet folder `PEOPLEOS` has no `SUPABASE_URL` entry. The owner supplies the Supabase project URL when they choose; it gets stored as KWallet entry `SUPABASE_URL`, then `npm run env:sync` must be re-run. Until then the app correctly serves the 503 guard. Evidence: `diagnostics/DIR-001-env-wiring.md`.
2. The two wallet keys belong to a Supabase project that is NOT the one referenced elsewhere on disk (401 verified). Evidence: `diagnostics/DIR-003-supabase-key-project-mismatch.md`.
3. All six migrations have never been applied to a real Supabase project — login, dashboard, and `/company/*` need them. See `docs/supabase-application-setup.md`.
4. No live Twilio / Microsoft / payroll credentials — tenants remain in `provisioning` until external blockers clear. See `docs/company-configuration.md`.

### Never do (carried forward)
- Do not touch other repositories. Do not run git. Do not print secrets. Do not hunt for missing values the owner has not asked you to find. Do not delete anything.

---

## APPEND-ONLY DIAGNOSTICS INDEX

Add new report paths at the end; never remove old ones.

- `diagnostics/README.md` — report index
- `diagnostics/DIR-001-env-wiring.md` — env manifest + KWallet sync wiring and run evidence (2026-11-10)
- `diagnostics/DIR-002-secret-leak-verification.md` — gitignore/history/staging verification (2026-11-10)
- `diagnostics/DIR-003-supabase-key-project-mismatch.md` — wallet keys vs. on-disk project URL evidence (2026-11-10)

### 2026-11-10 — session: PEOPLEOS-VERIFICATION-001 (independent verification) + keyring env model

| File | Change | Notes |
|---|---|---|
| `.env.local` | Rewrote to single-file keyring model:11 sensitive vars = literal `keyring`,2 settings = real values | gitignored; values never printed |
| `.env.example` | Mirrors `.env.local` (names + `keyring` markers + empty settings); value-free | kept only as the `cp` template |
| `env.manifest.json` | Retired — replaced with a pointer stub | owner directive: only `.env.local` is the list; supersedes rule 8's manifest flow |
| `scripts/sync-env.mjs` | Rewritten: scans code for vars, keeps `.env.local` complete, never reads KWallet, never touches `.env.example`, fails on credential-like values, no GET false positive (D-2) | `npm run env:sync` exit 0,13/13,0 appended |
| `scripts/with-keyring.mjs` | New launcher: resolves `keyring` markers from KWallet `PEOPLEOS` at spawn; missing entries skipped silently | wired into `dev`/`build`/`start` |
| `package.json` | `dev`/`build`/`start` now run through `with-keyring.mjs` | smoke: keys resolve len46/41, values not printed |
| `src/middleware.ts` | D-1 fix: not-configured guard also rejects literal `keyring` → clean 503 instead of 500 | retested: `GET /` and `/login` =503 + documented message; typecheck0; eslint0 |
| `README.md` | Env sections rewritten to keyring model; manifest references removed; Supabase step uses exact var names as wallet entries | user-facing; no threats |
| `docs/user-guide.md` | §9 troubleshooting rows + §10 environment section corrected to keyring model (D-3) | user-facing; no threats |
| `diagnostics/DIR-004`–`DIR-011` | Created: integrity, env, supabase, auth, core functionality, guide accuracy, validation, final acceptance A–G | append-only |
| `diagnostics/README.md` | Index lines appended for DIR-004–011 | append-only |

Validation after all changes: `typecheck` exit0, `lint` exit0, `env:sync` OK13/13. Earlier same session: `npm test` 81/81, `npm run build` exit0, `npm audit --audit-level=high` 0 vulnerabilities, `npm ls --depth=0` exit0. Full evidence in DIR-010.

---

## APPEND-ONLY STATE SNAPSHOT — 2026-11-10 (verification session)

### Working
- Env model: `.env.local` (authoritative,13 vars) → `keyring` markers → KWallet `PEOPLEOS` (entry = exact var name) → `scripts/with-keyring.mjs` resolves at `dev`/`build`/`start`. `npm run env:sync` = completeness checker only (exit0, no KWallet reads).
- Middleware serves HTTP503 "PeopleOS is not configured. Contact the system administrator." while any of URL/anon-key is empty or unresolved `keyring` — by design, verified live before and after D-1 fix.
- Validation suite green: typecheck0, lint0, test81/81, build0, audit0 vulns, env:sync13/13.
- Verification deliverables DIR-004…DIR-011 written; final acceptance report = DIR-011. Open application defects: none (D-1, D-2, D-3 fixed + retested).

### Owner-controlled state (not defects; owner acts when ready)
- KWallet `PEOPLEOS` entries currently unresolved (empty): `NEXT_PUBLIC_SUPABASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_SECRET`, `PAYROLL_PROVIDER_SECRET`. Resolved: `NEXT_PUBLIC_SUPABASE_ANON_KEY` (46), `SUPABASE_SERVICE_ROLE_KEY` (41). Legacy entries present: `DATABASE_PASSWORD`, `JWT_SIGNING_KEY`, `DEFAULT_SUPABASE_API`, `DEFAULT_SECRET_KEY`.
- Live Supabase DB/auth, migrations-on-real-project, Twilio, Microsoft, payroll: external prerequisites. Do NOT hunt for their values (DIR-006/007/008).

### Rules superseded by later owner directives (appended, not edited above)
- Rule4's "env.manifest.json … value-free": manifest retired to a stub; only `.env.local` (gitignored) and `.env.example` (keyring markers, no values) remain.
- Rule8's manifest-first flow: replaced by the single-file keyring model described in the Edit Log and State Snapshot above.

### Never do (carried forward)
- Do not touch other repositories. Do not run git. Do not print secrets. Do not hunt for missing values the owner has not asked you to find. Do not delete anything.

---

## APPEND-ONLY DIAGNOSTICS INDEX (continued)

- `diagnostics/DIR-004-repository-integrity.md` — V-001 scripts/links/files intact (2026-11-10)
- `diagnostics/DIR-005-environment-verification.md` — V-002 keyring model; D-1/D-2 fixed + retested (2026-11-10)
- `diagnostics/DIR-006-supabase-operational-verification.md` — V-003 clients/migrations/401 cause (2026-11-10)
- `diagnostics/DIR-007-authentication-verification.md` — V-004 guard/redirects live (2026-11-10)
- `diagnostics/DIR-008-core-functionality-verification.md` — V-005 per-feature matrix (2026-11-10)
- `diagnostics/DIR-009-user-guide-accuracy.md` — V-006 eleven-section walkthrough; 2 sections corrected (2026-11-10)
- `diagnostics/DIR-010-validation-results.md` — V-007 all commands green (2026-11-10)
- `diagnostics/DIR-011-final-operational-readiness.md` — acceptance report A–G (2026-11-10)
