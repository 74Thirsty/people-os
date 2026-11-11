import { describe, expect, it, beforeAll } from "vitest";
import {
  CompanyConfigValidationError,
  canonicalJson,
  hashCompanyConfig,
  listRepositoryCompanyConfigs,
  loadRepositoryCompanyConfig,
  nextConfigVersion,
  validateCompanyConfigDocument,
  type LoadedCompanyConfig
} from "./loader";
import { evaluateReadiness } from "./readiness";
import { createCompanyConfigService, type StoredConfigVersion } from "./service";
import {
  authorizeApproval,
  canAccessData,
  getRole,
  roleHasPermission
} from "./access";
import { evaluatePolicy } from "./policies";
import {
  authorizeAgentAction,
  resolveAgentContext
} from "./agents";
import {
  calculateOvertime,
  calculateShiftMinutes,
  evaluateClockEvent,
  evaluateTimeCorrection,
  resolvePayPeriod
} from "./timekeeping";

let spin: LoadedCompanyConfig;
let example: LoadedCompanyConfig;

beforeAll(() => {
  spin = loadRepositoryCompanyConfig("spin-marketing");
  example = loadRepositoryCompanyConfig("example-tenant");
});

function clone<T>(value: T): T {
  return structuredClone(value);
}

type InvalidConfigFixture = {
  communications?: { capabilities: { sms: boolean; mms: boolean; voice: boolean } };
  microsoft: { connection: { clientSecret: Record<string, unknown> } };
  hr: {
    policies: Array<{ status: string; source: { status: string }; enforcement: { mode: string } }>;
    timekeeping: { workweek: { policyId: string } };
  };
};

function expectInvalid(mutator: (config: InvalidConfigFixture) => void): void {
  const config = clone(spin.config) as unknown as InvalidConfigFixture;
  mutator(config);
  expect(() => validateCompanyConfigDocument(config)).toThrow(CompanyConfigValidationError);
}

describe("company configuration loading and schema", () => {
  it("loads the Spin Marketing and second test tenant through the same schema", () => {
    expect(spin.config.identity.slug).toBe("spin-marketing");
    expect(example.config.identity.slug).toBe("example-tenant");
    expect(spin.config.hr.policies).toHaveLength(24);
    expect(spin.config.microsoft.provider).toBe("microsoft");
    expect(spin.config.communications.capabilities).toEqual({ sms: true, mms: true, voice: true });
  });

  it("reports every repository tenant without silently skipping invalid files", () => {
    const entries = listRepositoryCompanyConfigs();
    expect(entries.map((entry) => entry.slug)).toContain("spin-marketing");
    expect(entries.map((entry) => entry.slug)).toContain("example-tenant");
    expect(entries.every((entry) => entry.error === null)).toBe(true);
  });

  it("rejects a missing required section", () => {
    expectInvalid((config) => { delete config.communications; });
  });

  it("rejects a communications provider without MMS capability", () => {
    expectInvalid((config) => { config.communications!.capabilities.mms = false; });
  });

  it("rejects an inline credential", () => {
    expectInvalid((config) => {
      config.microsoft.connection.clientSecret.value = "do-not-store-this";
    });
  });

  it("rejects automatic enforcement of an unconfirmed policy", () => {
    expectInvalid((config) => {
      config.hr.policies[4].status = "requires_confirmation";
      config.hr.policies[4].source.status = "inferred";
      config.hr.policies[4].enforcement.mode = "auto";
    });
  });

  it("rejects an unknown policy reference", () => {
    expectInvalid((config) => {
      config.hr.timekeeping.workweek.policyId = "NOPE-001";
    });
  });

  it("produces stable hashes and increments immutable versions", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(hashCompanyConfig(spin.config)).toBe(hashCompanyConfig(clone(spin.config)));
    expect(nextConfigVersion("1.0.0")).toBe("1.0.1");
    expect(nextConfigVersion("1.2.9", "minor")).toBe("1.3.0");
  });
});

describe("tenant-aware configuration resolution", () => {
  function store(configs: Record<string, { config: unknown; hash: string }>) {
    const rows = new Map<string, StoredConfigVersion>();
    for (const [tenantId, entry] of Object.entries(configs)) {
      rows.set(tenantId, {
        tenantId,
        version: "1.0.0",
        hash: entry.hash,
        config: entry.config,
        status: "active",
        source: "repository",
        createdAt: "2026-11-10T00:00:00Z",
        createdBy: null
      });
    }
    return { loadActiveConfigVersion: async (tenantId: string) => rows.get(tenantId) ?? null };
  }

  const memberships = {
    async loadMembership(tenantId: string, userId: string) {
      if (userId === "user-1" && tenantId === "tenant-1") return { role: "owner" };
      if (userId === "user-2" && tenantId === "tenant-2") return { role: "manager" };
      return null;
    }
  };

  it("resolves different configurations for two tenants", async () => {
    const service = createCompanyConfigService(
      store({
        "tenant-1": { config: spin.config, hash: spin.hash },
        "tenant-2": { config: example.config, hash: example.hash }
      }),
      memberships
    );
    const first = await service.resolveForMembership("tenant-1", "user-1");
    const second = await service.resolveForMembership("tenant-2", "user-2");
    expect(first.config.identity.slug).toBe("spin-marketing");
    expect(second.config.identity.slug).toBe("example-tenant");
    expect(first.role?.id).toBe("owner");
    expect(second.role?.id).toBe("manager");
  });

  it("rejects unauthorized cross-tenant configuration access", async () => {
    const service = createCompanyConfigService(
      store({ "tenant-1": { config: spin.config, hash: spin.hash } }),
      memberships
    );
    await expect(service.resolveForMembership("tenant-1", "user-2")).rejects.toThrow(/denied/i);
  });

  it("rejects a database configuration whose hash no longer matches", async () => {
    const service = createCompanyConfigService(
      store({ "tenant-1": { config: spin.config, hash: "0".repeat(64) } }),
      memberships
    );
    await expect(service.resolveForMembership("tenant-1", "user-1")).rejects.toThrow(/hash/i);
  });
});

describe("integration readiness", () => {
  it("does not claim operational Microsoft or telephony from file contents alone", () => {
    const report = evaluateReadiness(spin.config, { env: {} });
    expect(report.microsoft.state).toBe("not_configured");
    expect(report.communications.state).toBe("not_configured");
    expect(report.canActivate).toBe(false);
    expect(report.activationBlockers.join(" ")).toMatch(/Microsoft/);
    expect(report.activationBlockers.join(" ")).toMatch(/Communications/);
    expect(report.policies.requiringConfirmation).toHaveLength(24);
  });

  it("does not accept verified telephony without all three capabilities", () => {
    const report = evaluateReadiness(example.config, {
      env: {
        MICROSOFT_TENANT_ID: "fixture-tenant",
        MICROSOFT_CLIENT_ID: "fixture-client",
        MICROSOFT_CLIENT_SECRET: "fixture-secret",
        TWILIO_ACCOUNT_SID: "AC_fixture",
        TWILIO_AUTH_TOKEN: "fixture-token",
        TWILIO_PHONE_NUMBER: "+15005550006"
      },
      integrations: {
        microsoft: { provider: "microsoft", state: "verified", lastCheckedAt: "2026-11-10T00:00:00Z", evidence: "graph organization probe" },
        communications: {
          provider: "twilio",
          state: "verified",
          lastCheckedAt: "2026-11-10T00:00:00Z",
          evidence: "number lookup",
          capabilities: { sms: true, mms: false, voice: true }
        }
      }
    });
    expect(report.communications.state).toBe("provisioned");
    expect(report.communications.missing).toEqual(["mms"]);
    expect(report.canActivate).toBe(false);
  });

  it("becomes activatable only with verified integrations, business data, and confirmed policies", () => {
    const config = clone(example.config);
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
    );
    config.payroll.provider.status = "verified";
    config.payroll.provider.name = { value: "Fixture Payroll", status: "verified" };
    const parsed = validateCompanyConfigDocument(config);
    const report = evaluateReadiness(parsed, {
      env: {
        MICROSOFT_TENANT_ID: "fixture-tenant",
        MICROSOFT_CLIENT_ID: "fixture-client",
        MICROSOFT_CLIENT_SECRET: "fixture-secret",
        TWILIO_ACCOUNT_SID: "AC_fixture",
        TWILIO_AUTH_TOKEN: "fixture-token",
        TWILIO_PHONE_NUMBER: "+15005550006"
      },
      integrations: {
        microsoft: { provider: "microsoft", state: "verified", lastCheckedAt: "2026-11-10T00:00:00Z", evidence: "graph probe" },
        communications: {
          provider: "twilio", state: "verified", lastCheckedAt: "2026-11-10T00:00:00Z",
          evidence: "number lookup", capabilities: { sms: true, mms: true, voice: true }
        }
      }
    });
    expect(report.canActivate).toBe(true);
    expect(report.activationBlockers).toEqual([]);
  });
});

describe("workforce permissions and approval authority", () => {
  it("applies tenant role permissions and data boundaries", () => {
    const manager = getRole(spin.config, "manager");
    expect(roleHasPermission(manager, "timekeeping.correction.approve")).toBe(true);
    expect(roleHasPermission(manager, "payroll.release.approve")).toBe(false);
    expect(canAccessData(spin.config, "manager", "employeeRecords", "team")).toBe(true);
    expect(canAccessData(spin.config, "manager", "compensation", "team")).toBe(false);
    expect(canAccessData(spin.config, "owner", "compensation", "all")).toBe(true);
  });

  it("enforces the configured approval matrix and amount escalation", () => {
    expect(authorizeApproval(spin.config, "time_correction", "manager").allowed).toBe(true);
    expect(authorizeApproval(spin.config, "payroll_release", "manager").allowed).toBe(false);
    expect(authorizeApproval(spin.config, "payroll_release", "owner").allowed).toBe(true);
    expect(authorizeApproval(spin.config, "expense_reimbursement", "manager", 400).allowed).toBe(true);
    expect(authorizeApproval(spin.config, "expense_reimbursement", "manager", 900).allowed).toBe(false);
    expect(authorizeApproval(spin.config, "expense_reimbursement", "hr_administrator", 900).allowed).toBe(true);
  });

  it("never auto-enforces inferred Spin Marketing policy", () => {
    for (const policy of spin.config.hr.policies) {
      const evaluation = evaluatePolicy(spin.config, policy.id);
      expect(evaluation.enforceable).toBe(false);
      expect(evaluation.outcome).toBe("advisory");
    }
  });
});

describe("agent context isolation", () => {
  it("resolves company-specific instructions from each tenant configuration", () => {
    const spinContext = resolveAgentContext(spin.config, "hr_manager");
    const exampleContext = resolveAgentContext(example.config, "hr_manager");
    expect(spinContext.tenant.slug).toBe("spin-marketing");
    expect(exampleContext.tenant.slug).toBe("example-tenant");
    expect(spinContext.agent.instructions.join(" ")).toContain("Spin Marketing");
    expect(exampleContext.agent.instructions.join(" ")).toContain("Example Tenant");
    expect(spinContext.agent.instructions.join(" ")).not.toBe(exampleContext.agent.instructions.join(" "));
  });

  it("refuses unknown agents and prohibited actions", () => {
    expect(() => resolveAgentContext(spin.config, "other_tenant_agent")).toThrow(/Unknown agent/);
    expect(authorizeAgentAction(spin.config, "hr_manager", "payroll.release").allowed).toBe(false);
    expect(authorizeAgentAction(spin.config, "hr_manager", "leave.request.create").allowed).toBe(true);
  });

  it("limits policy access to the agent's configured scope", () => {
    const context = resolveAgentContext(example.config, "hr_manager");
    expect(context.policies.every((policy) => example.config.hr.policies.some((item) => item.id === policy.policyId))).toBe(true);
  });
});

describe("configuration-driven timekeeping", () => {
  it("resolves the configured biweekly pay period", () => {
    const period = resolvePayPeriod(spin.config, "2026-11-10");
    expect(period.start).toBe("2026-11-09");
    expect(period.end).toBe("2026-11-22");
    expect(period.cutoffDate).toBe("2026-11-20");
    expect(period.timezone).toBe("America/Chicago");
  });

  it("deducts the configured unpaid meal break", () => {
    const shift = calculateShiftMinutes(spin.config, {
      start: "2026-11-10T09:00:00-06:00",
      end: "2026-11-10T17:00:00-06:00"
    });
    expect(shift.rawMinutes).toBe(480);
    expect(shift.unpaidBreakMinutes).toBe(30);
    expect(shift.compensableMinutes).toBe(450);
    expect(shift.mealDeducted).toBe(true);
  });

  it("splits overtime at the configured weekly threshold", () => {
    const split = calculateOvertime(spin.config, { shiftMinutes: 480, priorWeeklyMinutes: 2280 });
    expect(split.regularMinutes).toBe(120);
    expect(split.overtimeMinutes).toBe(360);
    expect(split.multiplier).toBe(1.5);
  });

  it("applies attendance grace and correction windows", () => {
    const attendance = evaluateClockEvent(spin.config, {
      scheduledAt: "2026-11-10T09:00:00-06:00",
      occurredAt: "2026-11-10T09:10:00-06:00",
      kind: "clock_in"
    });
    expect(attendance.lateMinutes).toBe(3);
    expect(attendance.withinGrace).toBe(false);

    expect(evaluateTimeCorrection(spin.config, {
      occurredAt: "2026-11-01T12:00:00Z",
      submittedAt: "2026-11-10T12:00:00Z",
      hasEvidence: true
    }).status).toBe("pending_approval");

    expect(evaluateTimeCorrection(spin.config, {
      occurredAt: "2026-10-01T12:00:00Z",
      submittedAt: "2026-11-10T12:00:00Z",
      hasEvidence: true
    }).status).toBe("outside_window");
  });
});
