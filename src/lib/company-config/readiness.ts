import type { CompanyConfig, SourcedValue } from "./schema";

export type IntegrationState =
  | "not_configured"
  | "configured"
  | "provisioned"
  | "verified"
  | "operational"
  | "error";

export interface StoredIntegrationStatus {
  provider: "microsoft" | "twilio";
  state: IntegrationState;
  lastCheckedAt: string | null;
  evidence: string | null;
  capabilities?: { sms?: boolean; mms?: boolean; voice?: boolean };
}

export interface IntegrationReadiness {
  provider: "microsoft" | "twilio";
  state: IntegrationState;
  missing: string[];
  verifiedAt: string | null;
  evidence: string | null;
}

export interface CompanyReadiness {
  microsoft: IntegrationReadiness;
  communications: IntegrationReadiness;
  policies: {
    requiringConfirmation: string[];
    enforceable: string[];
  };
  business: {
    missing: string[];
    unverified: string[];
  };
  activationBlockers: string[];
  canActivate: boolean;
}

type Environment = Record<string, string | undefined>;

function resolved(value: SourcedValue, env: Environment): string | null {
  if (value.value) return value.value;
  if (value.envVar && env[value.envVar]) return env[value.envVar] ?? null;
  return null;
}

/**
 * Readiness never upgrades itself from a file claim. Only a stored integration
 * record produced by a successful live probe can mark a provider verified.
 */
export function evaluateReadiness(
  config: CompanyConfig,
  options: {
    env?: Environment;
    integrations?: Partial<Record<"microsoft" | "communications", StoredIntegrationStatus>>;
  } = {}
): CompanyReadiness {
  const env = options.env ?? process.env;
  const missingMicrosoft: string[] = [];
  if (!resolved(config.microsoft.connection.tenantId, env)) missingMicrosoft.push("MICROSOFT_TENANT_ID");
  if (!resolved(config.microsoft.connection.clientId, env)) missingMicrosoft.push("MICROSOFT_CLIENT_ID");
  if (!env[config.microsoft.connection.clientSecret.reference.replace(/^env:/, "")]) {
    missingMicrosoft.push(config.microsoft.connection.clientSecret.reference);
  }
  const microsoft = integrationReadiness("microsoft", missingMicrosoft, options.integrations?.microsoft);

  const missingCommunications: string[] = [];
  if (!resolved(config.communications.account.accountSid, env)) missingCommunications.push("TWILIO_ACCOUNT_SID");
  if (!env[config.communications.account.authToken.reference.replace(/^env:/, "")]) {
    missingCommunications.push(config.communications.account.authToken.reference);
  }
  if (!resolved(config.communications.phoneNumber.e164, env)) missingCommunications.push("TWILIO_PHONE_NUMBER");
  const communications = integrationReadiness(
    "twilio",
    missingCommunications,
    options.integrations?.communications,
    true
  );

  const requiringConfirmation = config.hr.policies
    .filter((policy) => policy.status === "proposed" || policy.status === "requires_confirmation")
    .map((policy) => policy.id);
  const enforceable = config.hr.policies
    .filter((policy) => policy.status === "active" || policy.status === "approved")
    .filter((policy) => policy.source.status === "verified" || policy.source.status === "example")
    .map((policy) => policy.id);

  const missingBusiness: string[] = [];
  if (!config.identity.legalName.trim()) missingBusiness.push("legalName");
  if (!config.identity.timezone.trim()) missingBusiness.push("timezone");
  if (config.identity.addresses.length === 0) missingBusiness.push("registeredAddress");
  if (resolved(config.identity.contact.email, env) === null) missingBusiness.push("contactEmail");
  if (!config.identity.jurisdictions.some((item) => item.employmentAuthorized === true)) {
    missingBusiness.push("authorizedJurisdiction");
  }
  if (config.identity.registration.status !== "verified") missingBusiness.push("registrationVerification");

  const unverified = Object.entries(config.identity.verification.fieldStatus)
    .filter(([, status]) => status !== "verified")
    .map(([field]) => field);

  const activationBlockers: string[] = [];
  if (missingBusiness.length > 0) {
    activationBlockers.push(`Business identity incomplete: ${missingBusiness.join(", ")}`);
  }
  if (unverified.length > 0) {
    activationBlockers.push(`Business identity unverified: ${unverified.join(", ")}`);
  }
  if (microsoft.state !== "verified" && microsoft.state !== "operational") {
    activationBlockers.push(`Microsoft integration is ${microsoft.state}; live verification is required`);
  }
  if (communications.state !== "verified" && communications.state !== "operational") {
    activationBlockers.push(`Communications integration is ${communications.state}; SMS, MMS, and voice must be verified`);
  }
  if (requiringConfirmation.length > 0) {
    activationBlockers.push(`HR policies require company confirmation: ${requiringConfirmation.join(", ")}`);
  }
  if (config.payroll.provider.status !== "verified" && config.payroll.provider.status !== "operational") {
    activationBlockers.push("Payroll provider is not verified; live payroll remains disabled");
  }

  return {
    microsoft,
    communications,
    policies: { requiringConfirmation, enforceable },
    business: { missing: missingBusiness, unverified },
    activationBlockers,
    canActivate: activationBlockers.length === 0
  };
}

function integrationReadiness(
  provider: "microsoft" | "twilio",
  missing: string[],
  stored: StoredIntegrationStatus | undefined,
  requireAllCapabilities = false
): IntegrationReadiness {
  if (missing.length > 0) {
    return { provider, state: "not_configured", missing, verifiedAt: null, evidence: null };
  }
  if (!stored || !stored.lastCheckedAt || !stored.evidence) {
    return { provider, state: "configured", missing: [], verifiedAt: null, evidence: null };
  }
  if (stored.state === "error") {
    return { provider, state: "error", missing: [], verifiedAt: stored.lastCheckedAt, evidence: stored.evidence };
  }
  if (requireAllCapabilities) {
    const capabilities = stored.capabilities ?? {};
    const missingCapabilities = (["sms", "mms", "voice"] as const)
      .filter((capability) => capabilities[capability] !== true);
    if (stored.state === "verified" || stored.state === "operational") {
      if (missingCapabilities.length > 0) {
        return {
          provider,
          state: "provisioned",
          missing: missingCapabilities,
          verifiedAt: stored.lastCheckedAt,
          evidence: stored.evidence
        };
      }
    }
  }
  return {
    provider,
    state: stored.state,
    missing: [],
    verifiedAt: stored.lastCheckedAt,
    evidence: stored.evidence
  };
}
