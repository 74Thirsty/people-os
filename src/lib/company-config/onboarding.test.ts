import { describe, expect, it, vi } from "vitest";
import { loadRepositoryCompanyConfig, hashCompanyConfig, validateCompanyConfigDocument, type LoadedCompanyConfig } from "./loader";
import {
  activateTenant,
  provisionTenantFromConfig,
  TenantActivationBlockedError,
  TenantOnboardingError,
  type TenantIntegrationWrite,
  type TenantOnboardingStore
} from "./onboarding";
import { ConfigEditSchema, applyConfigEdit } from "./admin";
import { decideInboundMessage, twimlMessage } from "@/lib/messaging/inbound";
import { createConfiguredHrsVerifiers } from "@/lib/hrs/company-config-guard";
import type { ApprovedHrsSchedule, HrsWorkflowVerifiers } from "@/lib/hrs-workflows";
import type { CompanyConfig } from "./schema";

const spin = loadRepositoryCompanyConfig("spin-marketing");
const example = loadRepositoryCompanyConfig("example-tenant");

function fakeStore() {
  const tenants = new Map<string, { id: string; status: string; slug: string }>();
  const versions = new Map<string, { version: string; hash: string }>();
  const integrations: Array<{ tenantId: string } & TenantIntegrationWrite> = [];
  const audits: Array<{ tenantId: string; eventType: string; payload: Record<string, unknown> }> = [];
  let counter = 0;
  const store: TenantOnboardingStore = {
    async findTenantBySlug(slug) {
      const tenant = [...tenants.values()].find((item) => item.slug === slug);
      return tenant ? { id: tenant.id, status: tenant.status } : null;
    },
    async createTenant(input) {
      const tenant = { id: `tenant-${++counter}`, status: input.status, slug: input.configSlug };
      tenants.set(tenant.id, tenant);
      return { id: tenant.id, status: tenant.status };
    },
    async ensureMembership() {},
    async loadActiveVersionSummary(tenantId) { return versions.get(tenantId) ?? null; },
    async publishConfigVersion(input) {
      versions.set(input.tenantId, { version: input.version, hash: input.hash });
    },
    async upsertIntegration(tenantId, integration) { integrations.push({ tenantId, ...integration }); },
    async updateTenantStatus(tenantId, status) {
      const tenant = tenants.get(tenantId);
      if (tenant) tenant.status = status;
    },
    async recordAudit(input) { audits.push({ tenantId: input.tenantId, eventType: input.eventType, payload: input.payload }); }
  };
  return { store, tenants, versions, integrations, audits };
}

function activatableConfig(): CompanyConfig {
  const config = structuredClone(example.config) as CompanyConfig;
  config.identity.contact.email = { value: "fixture@example.invalid", status: "verified" };
  config.identity.addresses = [{
    type: "registered", line1: "1 Fixture Way", city: "Austin", region: "TX",
    postalCode: "78701", country: "US", status: "verified"
  }];
  config.identity.registration.status = "verified";
  config.identity.registration.entityType = { value: "LLC", status: "verified" };
  config.identity.registration.registrationNumber = { value: "fixture-123", status: "verified" };
  config.identity.verification.fieldStatus = Object.fromEntries(
    Object.keys(config.identity.verification.fieldStatus).map((field) => [field, "verified"])
  ) as CompanyConfig["identity"]["verification"]["fieldStatus"];
  config.payroll.provider.status = "verified";
  config.payroll.provider.name = { value: "Fixture Payroll", status: "verified" };
  return validateCompanyConfigDocument(config);
}

const env = {
  MICROSOFT_TENANT_ID: "fixture-tenant",
  MICROSOFT_CLIENT_ID: "fixture-client",
  MICROSOFT_CLIENT_SECRET: "fixture-secret",
  TWILIO_ACCOUNT_SID: "AC_fixture",
  TWILIO_AUTH_TOKEN: "fixture-token",
  TWILIO_PHONE_NUMBER: "+15005550006"
};
const verifiedIntegrations = {
  microsoft: { provider: "microsoft" as const, state: "verified" as const, lastCheckedAt: "2026-11-10T00:00:00Z", evidence: "graph probe" },
  communications: {
    provider: "twilio" as const, state: "verified" as const, lastCheckedAt: "2026-11-10T00:00:00Z",
    evidence: "number lookup", capabilities: { sms: true, mms: true, voice: true }
  }
};

describe("tenant provisioning from configuration", () => {
  it("provisions a tenant environment without company-specific code", async () => {
    const fake = fakeStore();
    const result = await provisionTenantFromConfig(fake.store, spin, { actorUserId: "user-1", env: {} });
    expect(result.created).toBe(true);
    expect(result.status).toBe("provisioning");
    expect(result.configVersion).toBe("1.0.0");
    expect(result.published).toBe(true);
    expect(result.readiness.canActivate).toBe(false);
    expect(result.integrations.map((item) => item.state)).toEqual(["not_configured", "not_configured"]);
    expect(fake.audits[0].eventType).toBe("tenant.created");
    expect(JSON.stringify(fake.audits)).not.toContain("fixture-secret");
  });

  it("is idempotent for the same slug and configuration hash", async () => {
    const fake = fakeStore();
    await provisionTenantFromConfig(fake.store, spin, { actorUserId: "user-1", env: {} });
    const second = await provisionTenantFromConfig(fake.store, spin, { actorUserId: "user-1", env: {} });
    expect(second.created).toBe(false);
    expect(second.published).toBe(false);
    expect(fake.tenants.size).toBe(1);
    expect(fake.versions.get("tenant-1")?.hash).toBe(hashCompanyConfig(spin.config));
  });

  it("refuses a draft configuration without an explicit override", async () => {
    const fake = fakeStore();
    await expect(provisionTenantFromConfig(fake.store, example, { actorUserId: "user-1" }))
      .rejects.toBeInstanceOf(TenantOnboardingError);
  });

  it("blocks activation until integrations, business identity, and policies are ready", async () => {
    const fake = fakeStore();
    const result = await provisionTenantFromConfig(fake.store, spin, { actorUserId: "user-1", env: {} });
    await expect(activateTenant(fake.store, {
      tenantId: result.tenantId, config: spin.config, actorUserId: "user-1", env: {}
    })).rejects.toBeInstanceOf(TenantActivationBlockedError);
    expect(fake.tenants.get(result.tenantId)?.status).toBe("provisioning");
    expect(fake.audits.some((audit) => audit.eventType === "tenant.status.changed")).toBe(false);
  });

  it("activates only with verified integrations and complete business configuration", async () => {
    const fake = fakeStore();
    const config = activatableConfig();
    const loaded: LoadedCompanyConfig = { config, file: "fixture", hash: hashCompanyConfig(config), raw: config };
    const provisioned = await provisionTenantFromConfig(fake.store, loaded, {
      actorUserId: "user-1", env, integrations: verifiedIntegrations, allowDraft: true
    });
    await activateTenant(fake.store, {
      tenantId: provisioned.tenantId, config, actorUserId: "user-1", env, integrations: verifiedIntegrations
    });
    expect(fake.tenants.get(provisioned.tenantId)?.status).toBe("active");
    expect(fake.audits.at(-1)?.eventType).toBe("tenant.status.changed");
  });
});

describe("administrative configuration edits", () => {
  it("publishes a new immutable version and records policy verification", () => {
    const updated = applyConfigEdit(spin.config, {
      policies: [{ id: "TIME-002", status: "approved" }],
      contactEmail: "hr@example.invalid"
    }, { userId: "admin-1", now: () => new Date("2026-11-10T12:00:00Z") });
    expect(updated.configVersion).toBe("1.0.1");
    expect(updated.hr.policies.find((policy) => policy.id === "TIME-002")?.source.status).toBe("verified");
    expect(updated.hr.policies.find((policy) => policy.id === "TIME-002")?.effectiveDate).toBe("2026-11-10");
    expect(updated.identity.contact.email.value).toBe("hr@example.invalid");
    expect(updated.identity.verification.fieldStatus.contact).toBe("verified");
  });

  it("rejects unknown edit fields and unknown policies", () => {
    expect(ConfigEditSchema.safeParse({ system: "bypass" }).success).toBe(false);
    expect(() => applyConfigEdit(spin.config, { policies: [{ id: "NOPE-001", status: "approved" }] }, { userId: "admin-1" }))
      .toThrow(/Unknown policy/);
  });
});

describe("inbound messaging consent", () => {
  it("records STOP as opt-out and returns the configured acknowledgement", () => {
    const decision = decideInboundMessage(spin.config, {
      From: "+15005550100", To: "+15005550006", Body: "stop",
      MessageSid: `SM${"a".repeat(32)}`, NumMedia: "0"
    });
    expect(decision.kind).toBe("opt_out");
    expect(decision.consentState).toBe("opted_out");
    expect(decision.reply).toContain("opted out");
  });

  it("detects MMS and refuses a message sent to another company number", () => {
    const decision = decideInboundMessage(spin.config, {
      From: "+15005550100", To: "+15005550006", Body: "policy",
      MessageSid: `SM${"b".repeat(32)}`, NumMedia: "1", MediaUrl0: "https://example.com/a.jpg"
    });
    expect(decision.channel).toBe("mms");
    expect(decision.mediaUrls).toEqual(["https://example.com/a.jpg"]);

    const configured = structuredClone(spin.config);
    configured.communications.phoneNumber.e164 = { value: "+15005550006", status: "provisioning" };
    expect(() => decideInboundMessage(configured, {
      From: "+15005550100", To: "+15005559999", Body: "hello", MessageSid: `SM${"c".repeat(32)}`
    })).toThrow(/different company number/);
  });

  it("escapes TwiML replies", () => {
    expect(twimlMessage("a < b & c")).toContain("a &lt; b &amp; c");
  });
});

describe("HRS configuration guard", () => {
  function verifiers(): HrsWorkflowVerifiers {
    return { authorizeSchedule: vi.fn().mockResolvedValue(undefined), verifyClockEvent: vi.fn().mockResolvedValue(undefined) };
  }
  const schedule: ApprovedHrsSchedule = {
    tenantId: "tenant-1", employeeId: "employee-1", scheduledMinutes: 2400,
    scheduleVersion: "v1", approvedBy: "manager-1", approvedAt: "2026-11-10T08:00:00Z"
  };

  it("applies configured schedule approval authority before posting", async () => {
    const base = verifiers();
    const guarded = createConfiguredHrsVerifiers(spin.config, "manager", base);
    await guarded.authorizeSchedule(schedule);
    expect(base.authorizeSchedule).toHaveBeenCalledWith(schedule);
  });

  it("refuses a role that cannot approve schedule changes", async () => {
    const base = verifiers();
    const guarded = createConfiguredHrsVerifiers(spin.config, "payroll_administrator", base);
    await expect(guarded.authorizeSchedule(schedule)).rejects.toThrow(/denied/i);
    expect(base.authorizeSchedule).not.toHaveBeenCalled();
  });
});
