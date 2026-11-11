# DIR-004 — Repository integrity (V-001)

- **Date:** 2026-11-10
- **Directive:** PEOPLEOS-VERIFICATION-001, workstream V-001
- **Verdict:** PASS

## Checks performed

| Check | Method | Result |
|---|---|---|
| README instructions match package scripts | Compared README commands against `package.json` scripts | PASS — `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `env:sync`, `lockfile:refresh` all exist and match documented names |
| AGENTS.md append-only policy present | Read `AGENTS.md` | PASS — policy stated in header; edit log/state/diagnostics sections are append-structured |
| Documentation links resolve | Checked every relative link in README, AGENTS.md, docs/user-guide.md, diagnostics/README.md against the filesystem | PASS — all targets exist (`docs/user-guide.md`, `docs/supabase-application-setup.md`, `docs/company-configuration.md`, `docs/hrs-and-earned-wage-access.md`, `docs/hrs-custodial-token-economics.md`, `diagnostics/README.md`, `AGENTS.md`, `contracts/README.md`) |
| Referenced scripts exist | `scripts/sync-env.mjs`, `scripts/with-keyring.mjs` | PASS — both exist; both wired: `env:sync` → sync script, `dev`/`build`/`start` → launcher |
| Migrations referenced in docs exist | Listed `supabase/migrations/` | PASS — exactly the six documented files: `202611090001_initial_tenant_foundation.sql` … `202611100001_company_configuration.sql` |
| Pre-existing uncommitted work intact | `AGENTS.md` edit-log baseline vs filesystem | PASS — all pre-existing paths from the baseline still present; none modified by verification work except where recorded in defect fixes |
| `.env.example` present, value-free | Read file | PASS — contains only variable names + `keyring` markers + empty settings; no real values |

## Observed evidence vs inference

Observed: file contents, script names, migration directory listing, link-target existence.
Inference: "README matches behavior" for runtime claims rests on DIR-010 runtime tests, not this pass.

## Open items

None.
