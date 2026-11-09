# Company configuration contract

Each tenant has exactly one current, versioned JSON document in
`public.tenant_configurations`. The TypeScript contract is
`src/lib/company-configuration.ts`; the database enforces tenant ownership,
document size, revision concurrency, administrator-only writes, and audit
events.

## Contents

The document contains company identity and addresses; primary, HR, payroll,
and emergency email/phone contacts; administrators, managers, and employee
directory records; role and permission definitions; approval hierarchy;
employment policies; payroll settings; integration references; agent
configuration; and HRS custody settings.

## Data boundaries

This JSON document is the canonical company setup/configuration record.
Operational transactions remain normalized in PostgreSQL tables: employee
records used by transactional foreign keys, schedules, time events, payroll
runs, and HRS allocations/ledger entries. Do not put an append-only ledger or
unbounded transaction history inside JSONB.

Never store passwords, API tokens, private keys, bank account numbers, raw tax
identifiers, or signing material in this document. Store opaque references to
a protected secrets manager, payroll provider, or KMS/HSM. Do not put secrets
in agent-readable configuration. HRS employee wallet access is permanently
false in schema v1.

## Access and writes

Authenticated tenant members may read through RLS. Only tenant owners and
administrators may update via `PUT /api/tenants/:tenantId/configuration`.
Direct table writes are revoked. The update RPC checks the authenticated
membership role, tenant ID, schema version, 1 MiB database size limit, HRS
custody invariant, and expected revision. Revision mismatch returns HTTP 409.
Successful updates append an audit event in the same database transaction.

The API validates the complete document with Zod. Reads are marked private and
non-cacheable. The migration seeds defaults for both existing and newly
created tenants.

## Migration

Apply `202611090006_company_configuration.sql` after migration 005. Review
existing production data and take a verified backup before applying any
database migration. This migration does not activate payroll disbursement,
HRS posting, external communications, or employee self-service.
