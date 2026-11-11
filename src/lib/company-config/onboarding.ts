import {
  hashCompanyConfig,
  nextConfigVersion,
  validateCompanyConfigDocument,
  type LoadedCompanyConfig
} from "./loader";
import {
  evaluateReadiness,
  type CompanyReadiness,
  type StoredIntegrationStatus
} from "./readiness";
import type { CompanyConfig } from "./schema";

export class TenantOnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantOnboardingError";
  }
}

export class TenantActivationBlockedError extends Error {
  readonly blockers: string[];

  constructor(blockers: string[]) {
    super("Tenant activation is blocked by unresolved configuration and provisioning requirements");
    this.name = "TenantActivationBlockedError";
    this.blockers = blockers;
  }
}

export interface TenantIntegrationWrite {
  provider: "microsoft" | "twilio";
  state: string;
  credentialReferences: Record<string, string>;
  phoneE164: string | null;
  capabilities: Record<string, boolean>;
  evidence: string | null;
  lastCheckedAt: string | null;
}

export interface TenantOnboardingStore {
  findTenantBySlug(slug: string): Promise<{ id: string; status: string } | null>;
  createTenant(input: {
    configSlug: string;
    legalName: string;
    displayName: string;
    timezone: string;
    status: "provisioning" | "active";
  }): Promise<{ id: string; status: string }>;
  ensureMembership(tenantId: string, userId: string, role: "owner"): Promise<void>;
  loadActiveVersionSummary(tenantId: string): Promise<{ version: string; hash: string } | null>;
  publishConfigVersion(input: {
    tenantId: string;
    version: string;
    hash: string;
    config: CompanyConfig;
    source: "repository" | "admin";
    createdBy: string | null;
    changeSummary: string;
  }): Promise<void>;
  upsertIntegration(tenantId: string, integration: TenantIntegrationWrite): Promise<void>;
  updateTenantStatus(tenantId: string, status: "active" | "suspended" | "provisioning"): Promise<void>;
  recordAudit(input: {
    tenantId: string;
    actorUserId: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

export interface ProvisioningResult {
  tenantId: string;
  created: boolean;
  status: string;
  configVersion: string;
  configHash: string;
  readiness: CompanyReadiness;
  published: boolean;
  integrations: TenantIntegrationWrite[];
}

export async function provisionTenantFromConfig(
  store: TenantOnboardingStore,
  loaded: LoadedCompanyConfig,
  options: {
    actorUserId: string;
    env?: Record<string, string | undefined>;
    integrations?: Partial<Record<"microsoft" | "communications", StoredIntegrationStatus>>;
    allowDraft?: boolean;
  }
): Promise<ProvisioningResult> {
  const { config } = loaded;
  if (!options.actorUserId) throw new TenantOnboardingError("An authenticated provisioning actor is required");
  if (config.status === "retired") throw new TenantOnboardingError("Retired configurations cannot be provisioned");
  if (config.status === "draft" && !options.allowDraft) {
    throw new TenantOnboardingError("Draft configurations cannot be provisioned without an explicit override");
  }
  const readiness = evaluateReadiness(config, {
    env: options.env,
    integrations: options.integrations
  });
  const desiredStatus = readiness.canActivate && config.status === "active" ? "active" : "provisioning";
  let tenant = await store.findTenantBySlug(config.identity.slug);
  let created = false;
  if (!tenant) {
    tenant = await store.createTenant({
      configSlug: config.identity.slug,
      legalName: config.identity.legalName,
      displayName: config.identity.operatingName,
      timezone: config.identity.timezone,
      status: desiredStatus
    });
    created = true;
  }
  await store.ensureMembership(tenant.id, options.actorUserId, "owner");

  const existing = await store.loadActiveVersionSummary(tenant.id);
  const hash = hashCompanyConfig(config);
  const published = !(existing && existing.version === config.configVersion && existing.hash === hash);
  let version = config.configVersion;
  if (published) {
    if (existing?.version === config.configVersion && existing.hash !== hash) {
      version = nextConfigVersion(config.configVersion);
    }
    await store.publishConfigVersion({
      tenantId: tenant.id,
      version,
      hash,
      config,
      source: "repository",
      createdBy: options.actorUserId,
      changeSummary: `Provisioned from tenants/${config.identity.slug}/company.json`
    });
  } else if (existing) {
    version = existing.version;
  }

  const integrations: TenantIntegrationWrite[] = [
    {
      provider: "microsoft",
      state: readiness.microsoft.state,
      credentialReferences: {
        tenantId: config.microsoft.connection.tenantId.envVar ?? "MICROSOFT_TENANT_ID",
        clientId: config.microsoft.connection.clientId.envVar ?? "MICROSOFT_CLIENT_ID",
        clientSecret: config.microsoft.connection.clientSecret.reference
      },
      phoneE164: null,
      capabilities: {},
      evidence: readiness.microsoft.evidence,
      lastCheckedAt: readiness.microsoft.verifiedAt
    },
    {
      provider: "twilio",
      state: readiness.communications.state,
      credentialReferences: {
        accountSid: config.communications.account.accountSid.envVar ?? "TWILIO_ACCOUNT_SID",
        authToken: config.communications.account.authToken.reference
      },
      phoneE164: config.communications.phoneNumber.e164.value,
      capabilities: { ...config.communications.phoneNumber.verifiedCapabilities },
      evidence: readiness.communications.evidence,
      lastCheckedAt: readiness.communications.verifiedAt
    }
  ];
  for (const integration of integrations) await store.upsertIntegration(tenant.id, integration);

  await store.recordAudit({
    tenantId: tenant.id,
    actorUserId: options.actorUserId,
    eventType: created ? "tenant.created" : "tenant.configuration.provisioned",
    payload: {
      configSlug: config.identity.slug,
      configVersion: version,
      configHash: hash,
      tenantStatus: tenant.status,
      activationBlockers: readiness.activationBlockers,
      integrations: integrations.map((item) => ({ provider: item.provider, state: item.state }))
    }
  });

  return {
    tenantId: tenant.id,
    created,
    status: tenant.status,
    configVersion: version,
    configHash: hash,
    readiness,
    published,
    integrations
  };
}

export async function activateTenant(
  store: TenantOnboardingStore,
  input: {
    tenantId: string;
    config: CompanyConfig;
    actorUserId: string;
    env?: Record<string, string | undefined>;
    integrations?: Partial<Record<"microsoft" | "communications", StoredIntegrationStatus>>;
  }
): Promise<CompanyReadiness> {
  const readiness = evaluateReadiness(input.config, {
    env: input.env,
    integrations: input.integrations
  });
  if (!readiness.canActivate) throw new TenantActivationBlockedError(readiness.activationBlockers);
  await store.updateTenantStatus(input.tenantId, "active");
  await store.recordAudit({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    eventType: "tenant.status.changed",
    payload: { status: "active", configVersion: input.config.configVersion }
  });
  return readiness;
}

export async function suspendTenant(
  store: TenantOnboardingStore,
  input: { tenantId: string; actorUserId: string }
): Promise<void> {
  await store.updateTenantStatus(input.tenantId, "suspended");
  await store.recordAudit({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    eventType: "tenant.status.changed",
    payload: { status: "suspended" }
  });
}

export function revalidateProvisionedConfig(config: unknown): CompanyConfig {
  return validateCompanyConfigDocument(config);
}
