# Diagnostics

Directive reports for PeopleOS. Each report records one directive: what was ordered, what was done, the evidence, and what remains open.

**Append-only:** reports are never rewritten or deleted once written. New reports get new `DIR-00N-*.md` files and a new line at the end of the index below.

## Index

- `DIR-001-env-wiring.md` — environment variable manifest + KWallet → `.env.local` sync tooling (2026-11-10)
- `DIR-002-secret-leak-verification.md` — proof that `.env.local` is ignored, untracked, and never committed (2026-11-10)
- `DIR-003-supabase-key-project-mismatch.md` — evidence that the KWallet Supabase keys belong to a different project than the only URL on disk (2026-11-10)
- `DIR-004-repository-integrity.md` — PEOPLEOS-VERIFICATION-001 V-001: scripts/links/files intact (2026-11-10)
- `DIR-005-environment-verification.md` — V-002: keyring single-file model; defects D-1/D-2 fixed and retested (2026-11-10)
- `DIR-006-supabase-operational-verification.md` — V-003: clients, migrations,401 cause classification (2026-11-10)
- `DIR-007-authentication-verification.md` — V-004: guard/redirects live; magic-link flow static (2026-11-10)
- `DIR-008-core-functionality-verification.md` — V-005: per-feature implementation matrix (2026-11-10)
- `DIR-009-user-guide-accuracy.md` — V-006:11-section walkthrough;2 sections corrected (2026-11-10)
- `DIR-010-validation-results.md` — V-007: typecheck/lint/test/build/audit/smoke exit codes (2026-11-10)
- `DIR-011-final-operational-readiness.md` — acceptance report A-G (2026-11-10)
