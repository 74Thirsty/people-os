# DIR-010 — Application validation results (V-007)

- **Date:** 2026-11-10
- **Directive:** PEOPLEOS-VERIFICATION-001, workstream V-007
- **Verdict:** PASS — all available validation commands green

Scripts taken from `package.json` (no invented commands).

## Commands executed

| # | Command | Exit code | Result |
|---|---|---|---|
| 1 | `npm ls --depth=0` | 0 | dependency tree consistent |
| 2 | `npm audit --audit-level=high` | 0 | `found 0 vulnerabilities` |
| 3 | `npm run typecheck` | 0 | `tsc --noEmit` clean (after middleware fix; one TS2769 introduced and fixed during D-1 — final state clean) |
| 4 | `npm run lint` | 0 | `eslint .` — 0 errors; 2 warnings in `sync-env.mjs` (unused imports) found and removed; re-lint of touched files exit 0 |
| 5 | `npm test` | 0 | Vitest: **10 files, 81/81 tests passed** (2.48s) |
| 6 | `npm run build` | 0 | Next production build compiled; all16 routes generated; middleware bundle95.4 kB |
| 7 | `npm run env:sync` | 0 | 13 code vars =13 env-file vars;0 appended; no values printed |
| 8 | Launcher smoke (`with-keyring.mjs` wrapper) | 0 | anon key resolved len=46, service key resolved len=41 (state only, no values) |
| 9 | Runtime smoke: `npm run dev` + `GET /`, `GET /login` | HTTP **503** both | Correct guard response `PeopleOS is not configured. Contact the system administrator.` — the expected state with unresolved `keyring` markers (verified before AND after the D-1 fix; pre-fix was 500 and is the recorded defect) |

## Notes

- Integration tests use mocked provider responses (by design) — they prove request construction/signatures/consent gating, not live provider connectivity. Not counted as live passes.
- Contract (Vyper) tests not run — Python toolchain out of scope for this directive's application validation; contract code untouched.
- A successful build is not treated as proof of functional correctness — see DIR-008 for the static/live split.
