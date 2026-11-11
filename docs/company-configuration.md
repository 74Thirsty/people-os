# Universal company configuration

PeopleOS tenants are provisioned from a versioned JSON document, not company-specific application code. The same schema, loader, policy engine, approval engine, timekeeping rules, agent context resolver, and integration clients serve every tenant.

## Files

- `schemas/company-config.schema.json`: language-neutral JSON Schema (draft-07).
- `tenants/spin-marketing/company.json`: first reference tenant. Business identity, credentials, phone number, and policies that could not be verified are explicitly marked.
- `tenants/example-tenant/company.json`: non-production second tenant fixture proving that no tenant-specific code path is required.
- `src/lib/company-config/schema.ts`: Zod runtime contract plus cross-field/security rules.
- `src/lib/company-config/json-schema.ts`: Ajv validation against the committed schema.
- `src/lib/company-config/loader.ts`: safe slug/path resolution, JSON parsing, dual validation, canonical SHA-256 hashing, version increment.
- `src/lib/company-config/service.ts`: tenant-scoped active-version resolution with hash-integrity verification and membership checking.
- `src/lib/company-config/onboarding.ts`: provisioning and activation services.
- `src/lib/company-config/readiness.ts`: distinguishes `not_configured`, `configured`, `provisioned`, `verified`, `operational`, and `error`.

## Validation and versioning

Loading performs three gates in order:

1. JSON parsing (invalid JSON is rejected with the source file).
2. Universal JSON Schema validation (missing sections, unsupported capabilities, unknown fields, malformed references).
3. Zod cross-field validation: unique IDs, valid role/policy/action references, valid IANA timezone, no inline credentials, no tax identifier in the repository, payment-capability claims, policy/provenance consistency, and activation constraints.

A policy may only use `auto`, `block`, or `require_approval` enforcement when it is `approved` or `active` **and** its source is `verified` or explicitly `example`. Inferred Spin Marketing policies therefore evaluate as `advisory` and cannot silently block or auto-approve work.

The content hash is canonical (sorted keys) SHA-256. Runtime resolution recomputes the hash and refuses a database snapshot whose content no longer matches its stored hash. Administrative edits create a new immutable version via the service-role-only `publish_tenant_config_version` SQL function.

## Tenant resolution and isolation

- Repository configs are addressed by validated slug only; path traversal is rejected.
- Active configs are stored per tenant. `createCompanyConfigService` requires a tenant ID and verifies membership before returning configuration to a user.
- Agent context is resolved from exactly one active tenant configuration. There is no global instruction fallback and no cross-tenant store in the resolver.
- Inbound telephony routing resolves a unique provisioned phone number to exactly one tenant before any configuration is loaded.
- RLS grants tenant members read-only access to their own config versions, integrations, consent records, and messages. Writes are service-role-only behind authorized routes.

## What consumes configuration

| Area | Consumer |
| --- | --- |
| Roles, permissions, data boundaries | `src/lib/company-config/access.ts`, config API authorization |
| Approval authority and amount escalation | `authorizeApproval`, tenant status/config routes, HRS schedule guard |
| HR policy status/provenance | `src/lib/company-config/policies.ts`, agent contexts, admin policy editor |
| Pay periods, breaks, overtime, grace, corrections | `src/lib/company-config/timekeeping.ts` |
| HRS schedule authorization | `src/lib/hrs/company-config-guard.ts` via `createPeopleOsHrsWorkflow` |
| Agent instructions/policy scope | `resolveAgentContext` and `/api/agents/[agentId]/context` |
| Microsoft Graph identity/mail/calendar | `src/lib/integrations/microsoft-graph.ts`, integration health route |
| SMS/MMS/voice | `src/lib/integrations/twilio.ts`, inbound/status webhooks, integration health route |
| Notification channels/recipients | `src/lib/company-config/notifications.ts`, `/api/company/<tenant-id>/notifications` |
| Consent and opt-out | `decideInboundMessage`, Twilio webhook, `tenant_messaging_contacts` |
| Administrative changes/audit | `/company/<tenant-id>`, `/api/company/<tenant-id>/configuration`, version publication RPC |

## Provisioning a new company

1. Create `tenants/<slug>/company.json` and validate it with `npm test` (the repository configuration test loads every tenant directory).
2. Set server credentials: `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, and `PEOPLEOS_PLATFORM_ADMIN_EMAILS`. Optionally set `TWILIO_MESSAGING_SERVICE_SID` and `TWILIO_WEBHOOK_BASE_URL`.
3. As an allow-listed platform administrator, `POST /api/platform/onboarding` with `{ "slug": "<slug>" }`.
4. The tenant is created in `provisioning` status and the initial config version is published. Integrations are recorded as `configured` or `not_configured`, never verified by assumption.
5. An authorized tenant owner/administrator signs in, reviews `/company/<tenant-id>`, confirms policies, and runs the integration health check.
6. Activation succeeds only when business identity, all policies, Microsoft connectivity, SMS+MMS+voice capability, and payroll provider verification are complete.

Draft configs are refused by the platform route. `Spin Marketing` is `requires_confirmation`, not `draft`, so it can be provisioned but cannot activate until external provisioning and policy confirmation are complete.

## External integrations

Microsoft is mandatory and the only supported business identity/mail ecosystem. The Graph client uses the client-credentials flow with scopes from the configuration and never stores secrets in the config. The telephony provider is Twilio and must expose SMS, MMS, and voice on the provisioned number; `lookupNumberCapabilities` verifies all three before health can be `verified`.

Inbound webhooks validate the Twilio HMAC-SHA1 signature against the raw form parameters and configured URL. `STOP`, opt-in, and `HELP` behavior comes from the tenant configuration. Outbound/inbound messages and delivery statuses are tenant-scoped.

No live Microsoft or Twilio credentials were supplied in this environment. Integration tests use mocked provider responses and prove request construction, signatures, consent handling, and capability gating. They do not prove live connectivity.

## Current external blockers for Spin Marketing

- No real Microsoft Entra tenant ID, application client ID, or client secret.
- No purchased or verified phone number with SMS, MMS, and voice capability.
- No selected/verified payroll provider, tax profile, or bank configuration.
- No confirmed legal identity, registered address, jurisdictions, or HR policies from Spin Marketing.
- No real Supabase project/migrations applied in this build session.
