import { z } from "zod";

/**
 * Runtime contract for the universal company configuration.
 * schemas/company-config.schema.json is the language-neutral schema; this module
 * adds cross-field and security validation that JSON Schema cannot express.
 */

const semver = z.string().regex(/^\d+\.\d+\.\d+$/, "Must be a semantic version");
const roleId = z.string().regex(/^[a-z][a-z0-9_]{1,48}$/);
const actionId = z.string().regex(/^[a-z][a-z0-9_.-]{1,64}$/);
const permissionId = z.string().regex(/^(\*|[a-z][a-z0-9_.-]{1,80})$/);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be an ISO date");
const policyId = z.string().regex(/^[A-Z][A-Z0-9-]{2,30}$/);

const sourcedStatus = z.enum(["verified", "inferred", "requires_confirmation", "provisioning", "not_applicable"]);
export const SourcedValueSchema = z.object({
  value: z.string().nullable(),
  status: sourcedStatus,
  envVar: z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/).optional(),
  note: z.string().min(1).max(600).optional()
}).strict();

const SecretReferenceSchema = z.object({
  provider: z.enum(["env", "vault", "kms", "managed_secret"]),
  reference: z.string().regex(/^(env|vault|kms|managed):[A-Za-z0-9/_.:=@-]{3,220}$/),
  materialIncluded: z.literal(false),
  rotationDays: z.number().int().min(1).max(3650).optional()
}).strict();

const VerificationSchema = z.object({
  status: z.enum(["verified", "inferred", "requires_confirmation", "example"]),
  source: z.string().min(3).max(500),
  verifiedAt: z.string().nullable(),
  verifiedBy: z.string().nullable()
}).strict();

const PolicyStatusSchema = z.enum(["proposed", "requires_confirmation", "approved", "active", "retired"]);
const EnforcementModeSchema = z.enum(["auto", "require_approval", "block", "advisory"]);

const AddressSchema = z.object({
  type: z.enum(["registered", "mailing", "operating"]),
  line1: z.string().nullable(),
  line2: z.string().nullable().optional(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().regex(/^[A-Z]{2}$/),
  status: z.enum(["verified", "inferred", "requires_confirmation"]),
  note: z.string().max(500).optional()
}).strict();

const JurisdictionSchema = z.object({
  code: z.string().regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/),
  name: z.string().min(2).max(120),
  scope: z.enum(["country", "state", "local"]),
  employmentAuthorized: z.boolean().optional(),
  status: z.enum(["verified", "inferred", "requires_confirmation"])
}).strict();

const IdentitySchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,48}$/),
  legalName: z.string().min(2).max(200),
  operatingName: z.string().min(2).max(120),
  description: z.string().min(10).max(1000),
  industry: z.string().min(2).max(120),
  website: SourcedValueSchema,
  contact: z.object({ email: SourcedValueSchema, telephone: SourcedValueSchema }).strict(),
  addresses: z.array(AddressSchema).max(10),
  timezone: z.string().min(3).max(100),
  jurisdictions: z.array(JurisdictionSchema).min(1).max(20),
  registration: z.object({
    entityType: SourcedValueSchema,
    registrationNumber: SourcedValueSchema,
    taxIdentifier: SourcedValueSchema,
    registeredAddressConfirmed: z.boolean(),
    status: z.enum(["verified", "inferred", "requires_confirmation"]),
    note: z.string().max(500).optional()
  }).strict(),
  verification: z.object({
    fieldStatus: z.record(z.string(), z.enum(["verified", "inferred", "requires_confirmation", "example"])),
    lastReviewedAt: z.string().nullable()
  }).strict()
}).strict();

const MicrosoftServiceSchema = z.object({
  enabled: z.boolean(),
  purpose: z.string().min(3).max(300),
  verifiedAt: z.string().nullable()
}).strict();

const IntegrationHealthSchema = z.object({
  status: z.enum(["not_configured", "configured", "provisioned", "verified", "operational", "error"]),
  lastCheckedAt: z.string().nullable(),
  evidence: z.string().max(1000).nullable()
}).strict();

const MicrosoftSchema = z.object({
  required: z.literal(true),
  provider: z.literal("microsoft"),
  connection: z.object({
    tenantId: SourcedValueSchema,
    clientId: SourcedValueSchema,
    clientSecret: SecretReferenceSchema,
    certificateThumbprint: SourcedValueSchema.optional(),
    scopes: z.array(z.string().min(3)).min(1)
  }).strict(),
  services: z.object({
    m365: MicrosoftServiceSchema,
    entraId: MicrosoftServiceSchema,
    outlook: MicrosoftServiceSchema,
    graph: MicrosoftServiceSchema,
    teams: MicrosoftServiceSchema,
    sharedMailboxes: MicrosoftServiceSchema,
    employeeEmailProvisioning: MicrosoftServiceSchema,
    calendar: MicrosoftServiceSchema,
    authentication: MicrosoftServiceSchema
  }).strict(),
  mailboxes: z.object({
    shared: z.array(z.object({
      purpose: z.string().min(3).max(200),
      address: SourcedValueSchema,
      status: z.enum(["verified", "requires_confirmation", "provisioning"])
    }).strict()).max(20),
    employeeDomain: SourcedValueSchema,
    provisioningMode: z.literal("graph"),
    defaultUsageLocation: z.string().regex(/^[A-Z]{2}$/),
    defaultLicenseSku: SourcedValueSchema
  }).strict(),
  graph: z.object({
    baseUrl: z.literal("https://graph.microsoft.com/v1.0"),
    apiVersion: z.literal("v1.0")
  }).strict(),
  health: IntegrationHealthSchema
}).strict();

const NotificationRuleSchema = z.object({
  channels: z.array(z.enum(["sms", "mms", "voice", "email", "teams"])).min(1),
  recipients: z.array(z.string().min(2).max(80)).min(1),
  requiresConsent: z.literal(true)
}).strict();

const CommunicationsSchema = z.object({
  provider: z.literal("twilio"),
  required: z.literal(true),
  capabilities: z.object({
    sms: z.literal(true),
    mms: z.literal(true),
    voice: z.literal(true)
  }).strict(),
  account: z.object({
    accountSid: SourcedValueSchema,
    authToken: SecretReferenceSchema,
    messagingServiceSid: SourcedValueSchema
  }).strict(),
  phoneNumber: z.object({
    e164: SourcedValueSchema,
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    purpose: z.string().min(3).max(300),
    verifiedCapabilities: z.object({
      sms: z.boolean(),
      mms: z.boolean(),
      voice: z.boolean()
    }).strict(),
    provisioningStatus: z.enum(["not_purchased", "requested", "provisioned", "verified", "operational", "blocked"])
  }).strict(),
  consent: z.object({
    optInKeywords: z.array(z.string().min(2).max(30)),
    optOutKeywords: z.array(z.string().min(2).max(30)).min(1),
    helpKeywords: z.array(z.string().min(2).max(30)).min(1),
    confirmationMessage: z.string().min(3).max(300),
    optOutAcknowledgement: z.string().min(3).max(300),
    helpResponse: z.string().min(3).max(300),
    retentionDays: z.number().int().min(1).max(3650),
    sourceUrl: z.string().nullable()
  }).strict(),
  notifications: z.object({
    shiftReminder: NotificationRuleSchema,
    attendanceEscalation: NotificationRuleSchema,
    leaveDecision: NotificationRuleSchema,
    payrollApproval: NotificationRuleSchema,
    urgentSafety: NotificationRuleSchema,
    scheduleChange: NotificationRuleSchema
  }).strict(),
  webhooks: z.object({
    inboundPath: z.literal("/api/webhooks/twilio"),
    statusCallbackPath: z.literal("/api/webhooks/twilio/status"),
    signatureValidation: z.literal("twilio_signature_v1")
  }).strict(),
  health: IntegrationHealthSchema
}).strict();

const PolicySchema = z.object({
  id: policyId,
  name: z.string().min(3).max(160),
  category: z.enum([
    "employment", "hiring", "records", "scheduling", "attendance", "breaks", "overtime",
    "leave", "holidays", "payroll", "compensation", "expenses", "performance",
    "discipline", "conduct", "equal_opportunity", "safety", "termination", "privacy", "escalation"
  ]),
  description: z.string().min(10).max(1200),
  applicability: z.object({
    employmentTypes: z.array(z.string()),
    jurisdictions: z.array(z.string()),
    locations: z.array(z.string()).optional()
  }).strict(),
  rules: z.record(z.string(), z.union([
    z.string(), z.number(), z.boolean(), z.null(),
    z.array(z.union([z.string(), z.number(), z.boolean()]))
  ])),
  approvals: z.object({
    requiredRoles: z.array(roleId),
    minimumApprovals: z.number().int().min(1).max(10),
    escalateTo: z.string().nullable()
  }).strict(),
  responsibleRoles: z.array(roleId),
  effectiveDate: dateString,
  jurisdiction: z.string().min(2).max(20),
  enforcement: z.object({
    mode: EnforcementModeSchema,
    behavior: z.string().min(5).max(600)
  }).strict(),
  exceptions: z.array(z.string().max(400)),
  escalation: z.array(z.string().max(400)),
  status: PolicyStatusSchema,
  source: VerificationSchema
}).strict();

const ApprovalRuleSchema = z.object({
  action: actionId,
  requiredRoles: z.array(roleId).min(1),
  minimumApprovals: z.number().int().min(1).max(10),
  amountThreshold: z.number().min(0).nullable(),
  escalateTo: z.string().nullable(),
  notes: z.string().max(400).optional()
}).strict();

const HrSchema = z.object({
  employmentClassifications: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9_]{1,48}$/),
    name: z.string().min(2).max(100),
    description: z.string().min(5).max(500),
    overtimeEligible: z.boolean(),
    benefitsEligible: z.boolean(),
    status: PolicyStatusSchema,
    source: VerificationSchema
  }).strict()).min(1),
  policies: z.array(PolicySchema).min(1),
  approvals: z.object({ matrix: z.array(ApprovalRuleSchema).min(1) }).strict(),
  timekeeping: z.object({
    workweek: z.object({
      startDay: z.enum(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]),
      timezone: z.string().min(3),
      policyId: z.string()
    }).strict(),
    payPeriods: z.object({
      frequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]),
      anchorDate: dateString,
      timezone: z.string().min(3),
      cutoffDaysBeforeEnd: z.number().int().min(0).max(14),
      approvalAction: actionId,
      policyId: z.string()
    }).strict(),
    breaks: z.object({
      unpaidMeal: z.object({
        triggerAfterMinutes: z.number().int().min(0).max(1440),
        minimumMinutes: z.number().int().min(0).max(240),
        maximumMinutes: z.number().int().min(0).max(240),
        autoDeduct: z.boolean(),
        policyId: z.string()
      }).strict(),
      rest: z.array(z.object({
        name: z.string().min(2).max(100),
        paid: z.boolean(),
        minutes: z.number().int().min(0).max(120),
        perHoursWorked: z.number().min(0).max(24),
        policyId: z.string()
      }).strict())
    }).strict(),
    overtime: z.object({
      weeklyThresholdMinutes: z.number().int().min(1).max(10080),
      dailyThresholdMinutes: z.number().int().min(1).max(1440).nullable(),
      multiplier: z.number().min(1).max(3),
      treatment: z.enum(["weekly", "daily_and_weekly", "none"]),
      policyId: z.string()
    }).strict(),
    grace: z.object({
      clockInMinutes: z.number().int().min(0).max(60),
      clockOutMinutes: z.number().int().min(0).max(60),
      policyId: z.string()
    }).strict(),
    rounding: z.object({
      mode: z.enum(["none", "nearest_quarter_hour", "nearest_tenth_hour"]),
      incrementMinutes: z.number().int().min(1).max(60),
      policyId: z.string()
    }).strict(),
    missedPunch: z.object({
      correctionRequiresApproval: z.boolean(),
      approvalAction: actionId,
      maxCorrectionDays: z.number().int().min(0).max(365),
      policyId: z.string()
    }).strict()
  }).strict(),
  leave: z.object({
    requestAdvanceDays: z.number().int().min(0).max(365),
    maxConsecutiveDays: z.number().int().min(1).max(365),
    types: z.array(z.object({
      id: z.string().regex(/^[a-z][a-z0-9_]{1,48}$/),
      name: z.string().min(2).max(100),
      paid: z.boolean(),
      accrual: z.object({
        annualAllowanceMinutes: z.number().int().min(0).nullable(),
        accrualMethod: z.enum(["none", "per_pay_period", "monthly", "annual_grant"]),
        accrualMinutesPerPeriod: z.number().int().min(0).nullable()
      }).strict(),
      requiresApproval: z.boolean(),
      approvalAction: actionId,
      policyId: z.string(),
      status: PolicyStatusSchema
    }).strict()).min(1)
  }).strict(),
  holidays: z.array(z.object({
    date: dateString,
    name: z.string().min(2).max(100),
    paid: z.boolean(),
    jurisdiction: z.string().min(2).max(20),
    status: PolicyStatusSchema,
    policyId: z.string()
  }).strict()),
  onboarding: z.object({
    tasks: z.array(z.string().min(3)),
    requiredDocuments: z.array(z.string().min(3)),
    probationDays: z.number().int().min(0).max(730).nullable(),
    policyId: z.string()
  }).strict(),
  offboarding: z.object({
    tasks: z.array(z.string().min(3)),
    returnAssets: z.array(z.string().min(2)),
    revokeAccessWithinHours: z.number().int().min(0).max(168),
    finalPayPolicyId: z.string(),
    policyId: z.string()
  }).strict(),
  performance: z.object({
    reviewFrequency: z.enum(["monthly", "quarterly", "annual", "none"]),
    probationReviewDays: z.number().int().min(0).max(730).nullable(),
    policyId: z.string()
  }).strict(),
  conduct: z.object({
    complaintChannels: z.array(z.string().min(2)).min(1),
    investigationRequired: z.boolean(),
    policyIds: z.array(z.string()).min(1)
  }).strict(),
  safety: z.object({
    emergencyContact: SourcedValueSchema,
    reportingChannels: z.array(z.string().min(2)).min(1),
    incidentReportRequired: z.boolean(),
    policyId: z.string()
  }).strict(),
  privacy: z.object({
    documentRetentionDays: z.number().int().min(1).max(36500),
    payrollRetentionYears: z.number().int().min(1).max(100),
    employeeRecordRetentionYears: z.number().int().min(1).max(100),
    policyId: z.string()
  }).strict()
}).strict();

const DataAccessSchema = z.object({
  employeeRecords: z.enum(["all", "team", "self", "none"]),
  compensation: z.enum(["all", "team", "self", "none"]),
  documents: z.enum(["all", "team", "self", "none"]),
  messages: z.enum(["all", "team", "self", "none"])
}).strict();

const WorkforceRoleSchema = z.object({
  id: roleId,
  name: z.string().min(2).max(100),
  membershipRole: z.enum(["owner", "administrator", "manager", "auditor"]).nullable(),
  permissions: z.array(permissionId).min(1),
  dataAccess: DataAccessSchema,
  escalationTo: z.string().nullable()
}).strict();

const WorkforceSchema = z.object({
  roles: z.array(WorkforceRoleSchema).min(1),
  approvalHierarchy: z.array(z.object({
    level: z.number().int().min(1).max(20),
    roleId,
    canApproveActions: z.array(actionId),
    maxAmount: z.number().min(0).nullable()
  }).strict()),
  delegation: z.object({
    allowed: z.boolean(),
    maxDays: z.number().int().min(0).max(365),
    requiresApprovalBy: roleId
  }).strict(),
  reporting: z.object({
    defaultManagerRoleId: roleId,
    requireManagerAssignment: z.boolean(),
    crossTenantReportingAllowed: z.literal(false)
  }).strict()
}).strict();

const AgentDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{1,48}$/),
  name: z.string().min(2).max(80),
  enabled: z.boolean(),
  purpose: z.string().min(10).max(500),
  instructions: z.array(z.string().min(5).max(800)).min(1),
  permittedActions: z.array(actionId),
  prohibitedActions: z.array(z.string().min(2).max(120)),
  escalationConditions: z.array(z.string().min(3).max(400)),
  approvalRequiredFor: z.array(actionId),
  channels: z.array(z.enum(["sms", "mms", "voice", "email", "teams", "web"])).min(1),
  workflowAccess: z.array(z.string().min(2).max(80)),
  policyAccess: z.array(z.string().min(1).max(80)).min(1),
  audit: z.object({
    logReads: z.boolean(),
    logActions: z.boolean(),
    retentionDays: z.number().int().min(1).max(36500)
  }).strict()
}).strict();

const AgentsSchema = z.object({
  runtime: z.object({
    instructionResolution: z.literal("active_tenant_configuration"),
    auditAllActions: z.literal(true),
    crossTenantContext: z.literal("deny"),
    policyResolution: z.literal("active_tenant_configuration")
  }).strict(),
  definitions: z.array(AgentDefinitionSchema).min(1)
}).strict();

const PayrollSchema = z.object({
  provider: z.object({
    name: SourcedValueSchema,
    credentials: SecretReferenceSchema,
    status: z.enum(["not_configured", "configured", "provisioned", "verified", "operational"])
  }).strict(),
  currency: SourcedValueSchema,
  payPeriods: z.object({
    frequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]),
    anchorDate: dateString,
    timezone: z.string().min(3),
    approvalAction: actionId,
    releaseRequiresDualApproval: z.boolean(),
    cutoffDaysBeforeEnd: z.number().int().min(0).max(14)
  }).strict(),
  compensation: z.object({
    payRateChangeRequiresApproval: z.boolean(),
    bankAccountChangeRequiresApproval: z.boolean(),
    effectiveDateRule: z.string().min(5).max(400),
    minimumWageReviewStatus: z.enum(["verified", "requires_confirmation", "not_reviewed"])
  }).strict(),
  timeTokens: z.object({
    model: z.literal("hrs_minutes"),
    mintRequiresApprovedSchedule: z.literal(true),
    consumeRequiresVerifiedClockEvent: z.literal(true),
    overtimeTreatment: z.enum(["scheduled_capacity_only", "separate_overtime_allocation", "not_modeled"]),
    correctionsRequireApproval: z.literal(true),
    maxRetroactiveCorrectionDays: z.number().int().min(0).max(365),
    reconcileAtPeriodClose: z.literal(true),
    cashOutEnabled: z.literal(false),
    isWages: z.literal(false)
  }).strict(),
  expenses: z.object({
    reimbursementRequiresApproval: z.boolean(),
    approvalAction: actionId,
    receiptRequiredOverAmount: z.number().min(0),
    submissionWindowDays: z.number().int().min(1).max(365),
    policyId: z.string()
  }).strict()
}).strict();

const SecuritySchema = z.object({
  tenantIsolation: z.object({
    enforcedBy: z.array(z.enum(["row_level_security", "service_boundary", "application_scope"])).min(1),
    crossTenantAccess: z.literal("deny"),
    agentContextScope: z.literal("tenant")
  }).strict(),
  secretManagement: z.object({
    provider: z.enum(["env", "managed_secret_store"]),
    referencesOnly: z.literal(true),
    rotationDays: z.number().int().min(1).max(3650),
    prohibitedInRepository: z.array(z.string())
  }).strict(),
  sensitiveFields: z.array(z.object({
    path: z.string().min(3),
    classification: z.enum(["internal", "confidential", "restricted"]),
    accessRoles: z.array(roleId),
    encryption: z.enum(["at_rest_required", "field_level_required"]),
    retentionDays: z.number().int().min(1).max(36500)
  }).strict()).min(1),
  audit: z.object({
    requiredEvents: z.array(z.string().min(3)).min(1),
    retentionDays: z.number().int().min(1).max(36500),
    immutable: z.literal(true)
  }).strict(),
  configurationManagement: z.object({
    versioning: z.literal("immutable_snapshots"),
    changeRequiresApproval: z.literal(true),
    approvalRoles: z.array(roleId).min(1),
    activationRequires: z.array(z.string().min(3)).min(1)
  }).strict(),
  retention: z.object({
    employeeRecordsDays: z.number().int().min(1).max(36500),
    payrollRecordsDays: z.number().int().min(1).max(36500),
    messagesDays: z.number().int().min(1).max(36500),
    auditDays: z.number().int().min(1).max(36500),
    policyVersionDays: z.number().int().min(1).max(36500)
  }).strict()
}).strict();

const CompanyConfigShape = z.object({
  $schema: z.string().optional(),
  schemaVersion: z.literal("1.0.0"),
  configVersion: semver,
  status: z.enum(["draft", "requires_confirmation", "active", "suspended", "retired"]),
  identity: IdentitySchema,
  microsoft: MicrosoftSchema,
  communications: CommunicationsSchema,
  hr: HrSchema,
  workforce: WorkforceSchema,
  agents: AgentsSchema,
  payroll: PayrollSchema,
  security: SecuritySchema
}).strict();

export const CompanyConfigSchema = CompanyConfigShape.superRefine(validateCrossFieldRules);
export type CompanyConfig = z.infer<typeof CompanyConfigShape>;
export type Policy = z.infer<typeof PolicySchema>;
export type WorkforceRole = z.infer<typeof WorkforceRoleSchema>;
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
export type ApprovalRule = z.infer<typeof ApprovalRuleSchema>;
export type SourcedValue = z.infer<typeof SourcedValueSchema>;

function duplicateIds(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

/** Reject any string that looks like a live credential instead of a reference. */
export function assertNoInlineSecrets(input: unknown, path = "$"): void {
  if (Array.isArray(input)) {
    input.forEach((value, index) => assertNoInlineSecrets(value, `${path}[${index}]`));
    return;
  }
  if (!input || typeof input !== "object") return;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const nextPath = `${path}.${key}`;
    if (/^(client_?secret|auth_?token|api_?key|password|private_?key|secret|credentials|oauth_?token|access_?token|refresh_?token)$/i.test(key)) {
      if (typeof value === "string" && !/^(env|vault|kms|managed):[A-Za-z0-9/_.:=@-]{3,220}$/.test(value)) {
        throw new Error(`Inline secret is not permitted at ${nextPath}; use a secret reference`);
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        if (record.materialIncluded !== false ||
            typeof record.reference !== "string" ||
            !/^(env|vault|kms|managed):[A-Za-z0-9/_.:=@-]{3,220}$/.test(record.reference)) {
          throw new Error(`Credential field at ${nextPath} must be a reference with materialIncluded=false`);
        }
      }
    }
    assertNoInlineSecrets(value, nextPath);
  }
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function validateCrossFieldRules(config: z.infer<typeof CompanyConfigShape>, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });

  if (!validTimezone(config.identity.timezone)) {
    issue(["identity", "timezone"], "Must be a valid IANA time zone");
  }

  const policyIds = new Set(config.hr.policies.map((policy) => policy.id));
  const roleIds = new Set(config.workforce.roles.map((role) => role.id));
  const approvalActions = new Set(config.hr.approvals.matrix.map((rule) => rule.action));

  for (const duplicate of duplicateIds(config.hr.policies.map((policy) => policy.id))) {
    issue(["hr", "policies"], `Duplicate policy id: ${duplicate}`);
  }
  for (const duplicate of duplicateIds(config.workforce.roles.map((role) => role.id))) {
    issue(["workforce", "roles"], `Duplicate role id: ${duplicate}`);
  }
  for (const duplicate of duplicateIds(config.agents.definitions.map((agent) => agent.id))) {
    issue(["agents", "definitions"], `Duplicate agent id: ${duplicate}`);
  }
  for (const duplicate of duplicateIds(config.hr.approvals.matrix.map((rule) => rule.action))) {
    issue(["hr", "approvals", "matrix"], `Duplicate approval action: ${duplicate}`);
  }
  for (const duplicate of duplicateIds(config.hr.employmentClassifications.map((item) => item.id))) {
    issue(["hr", "employmentClassifications"], `Duplicate employment classification: ${duplicate}`);
  }
  for (const duplicate of duplicateIds(config.hr.leave.types.map((item) => item.id))) {
    issue(["hr", "leave", "types"], `Duplicate leave type: ${duplicate}`);
  }

  const requirePolicy = (id: string, path: (string | number)[]) => {
    if (!policyIds.has(id)) issue(path, `Unknown policy reference: ${id}`);
  };
  const requireRole = (id: string, path: (string | number)[]) => {
    if (!roleIds.has(id)) issue(path, `Unknown role reference: ${id}`);
  };
  const requireAction = (id: string, path: (string | number)[]) => {
    if (!approvalActions.has(id)) issue(path, `No approval matrix rule for action: ${id}`);
  };
  const requireSourced = (value: { value: string | null; status: string }, path: (string | number)[]) => {
    if ((value.status === "verified" || value.status === "inferred") && value.value === null) {
      issue(path, `A ${value.status} value must be present`);
    }
  };

  requireSourced(config.identity.website, ["identity", "website"]);
  requireSourced(config.identity.contact.email, ["identity", "contact", "email"]);
  requireSourced(config.identity.contact.telephone, ["identity", "contact", "telephone"]);
  requireSourced(config.identity.registration.entityType, ["identity", "registration", "entityType"]);
  requireSourced(config.identity.registration.registrationNumber, ["identity", "registration", "registrationNumber"]);

  if (config.identity.registration.taxIdentifier.value !== null) {
    issue(["identity", "registration", "taxIdentifier"], "Tax identifiers must be resolved from the secret store, never stored in configuration");
  }
  const email = config.identity.contact.email.value;
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issue(["identity", "contact", "email", "value"], "Must be an email address");
  }
  const website = config.identity.website.value;
  if (website !== null) {
    try { new URL(website); } catch { issue(["identity", "website", "value"], "Must be an absolute URL"); }
  }
  if (!config.identity.jurisdictions.some((item) => item.employmentAuthorized === true)) {
    issue(["identity", "jurisdictions"], "At least one jurisdiction must authorize employment");
  }

  const phone = config.communications.phoneNumber;
  if (phone.e164.value !== null && !/^\+[1-9]\d{7,14}$/.test(phone.e164.value)) {
    issue(["communications", "phoneNumber", "e164", "value"], "Must be an E.164 phone number");
  }
  if (phone.provisioningStatus === "verified" || phone.provisioningStatus === "operational") {
    if (phone.e164.value === null) {
      issue(["communications", "phoneNumber", "e164"], "A verified number requires a purchased E.164 value");
    }
    if (!phone.verifiedCapabilities.sms || !phone.verifiedCapabilities.mms || !phone.verifiedCapabilities.voice) {
      issue(["communications", "phoneNumber", "verifiedCapabilities"], "Operational messaging requires verified SMS, MMS, and voice capability");
    }
  }
  if (!config.communications.consent.optOutKeywords.some((word) => word.toUpperCase() === "STOP")) {
    issue(["communications", "consent", "optOutKeywords"], "STOP must be honored as an opt-out keyword");
  }
  if (config.communications.consent.sourceUrl !== null) {
    try { new URL(config.communications.consent.sourceUrl); }
    catch { issue(["communications", "consent", "sourceUrl"], "Must be an absolute URL"); }
  }
  for (const [key, rule] of Object.entries(config.communications.notifications)) {
    for (const recipient of rule.recipients) {
      if (recipient !== "employee") requireRole(recipient, ["communications", "notifications", key, "recipients"]);
    }
  }
  for (const [name, health] of [
    ["microsoft", config.microsoft.health],
    ["communications", config.communications.health]
  ] as const) {
    if ((health.status === "verified" || health.status === "operational") && (!health.lastCheckedAt || !health.evidence)) {
      issue([name, "health"], "Verified or operational health requires a check timestamp and evidence");
    }
  }

  for (const [index, policy] of config.hr.policies.entries()) {
    for (const role of policy.approvals.requiredRoles) requireRole(role, ["hr", "policies", index, "approvals", "requiredRoles"]);
    for (const role of policy.responsibleRoles) requireRole(role, ["hr", "policies", index, "responsibleRoles"]);
    if (policy.approvals.escalateTo) requireRole(policy.approvals.escalateTo, ["hr", "policies", index, "approvals", "escalateTo"]);
    if (policy.status === "active" || policy.status === "approved") {
      if (policy.source.status !== "verified" && policy.source.status !== "example") {
        issue(["hr", "policies", index, "source"], "Approved or active policies require verified or example provenance");
      }
    }
    if (policy.enforcement.mode !== "advisory") {
      if (policy.status !== "active" && policy.status !== "approved") {
        issue(["hr", "policies", index, "enforcement"], "Unconfirmed policies cannot be automatically enforced");
      }
      if (policy.source.status !== "verified" && policy.source.status !== "example") {
        issue(["hr", "policies", index, "enforcement"], "Enforcement requires verified or example provenance");
      }
    }
  }

  const timekeeping = config.hr.timekeeping;
  requirePolicy(timekeeping.workweek.policyId, ["hr", "timekeeping", "workweek", "policyId"]);
  requirePolicy(timekeeping.payPeriods.policyId, ["hr", "timekeeping", "payPeriods", "policyId"]);
  requirePolicy(timekeeping.breaks.unpaidMeal.policyId, ["hr", "timekeeping", "breaks", "unpaidMeal", "policyId"]);
  timekeeping.breaks.rest.forEach((rest, index) =>
    requirePolicy(rest.policyId, ["hr", "timekeeping", "breaks", "rest", index, "policyId"]));
  requirePolicy(timekeeping.overtime.policyId, ["hr", "timekeeping", "overtime", "policyId"]);
  requirePolicy(timekeeping.grace.policyId, ["hr", "timekeeping", "grace", "policyId"]);
  requirePolicy(timekeeping.rounding.policyId, ["hr", "timekeeping", "rounding", "policyId"]);
  requirePolicy(timekeeping.missedPunch.policyId, ["hr", "timekeeping", "missedPunch", "policyId"]);
  requireAction(timekeeping.payPeriods.approvalAction, ["hr", "timekeeping", "payPeriods", "approvalAction"]);
  requireAction(timekeeping.missedPunch.approvalAction, ["hr", "timekeeping", "missedPunch", "approvalAction"]);

  config.hr.leave.types.forEach((type, index) => {
    requirePolicy(type.policyId, ["hr", "leave", "types", index, "policyId"]);
    requireAction(type.approvalAction, ["hr", "leave", "types", index, "approvalAction"]);
  });
  config.hr.holidays.forEach((holiday, index) =>
    requirePolicy(holiday.policyId, ["hr", "holidays", index, "policyId"]));
  requirePolicy(config.hr.onboarding.policyId, ["hr", "onboarding", "policyId"]);
  requirePolicy(config.hr.offboarding.policyId, ["hr", "offboarding", "policyId"]);
  requirePolicy(config.hr.offboarding.finalPayPolicyId, ["hr", "offboarding", "finalPayPolicyId"]);
  requirePolicy(config.hr.performance.policyId, ["hr", "performance", "policyId"]);
  config.hr.conduct.policyIds.forEach((id, index) =>
    requirePolicy(id, ["hr", "conduct", "policyIds", index]));
  requirePolicy(config.hr.safety.policyId, ["hr", "safety", "policyId"]);
  requirePolicy(config.hr.privacy.policyId, ["hr", "privacy", "policyId"]);

  config.hr.approvals.matrix.forEach((rule, index) => {
    rule.requiredRoles.forEach((role) => requireRole(role, ["hr", "approvals", "matrix", index, "requiredRoles"]));
    if (rule.escalateTo) requireRole(rule.escalateTo, ["hr", "approvals", "matrix", index, "escalateTo"]);
  });

  config.workforce.roles.forEach((role, index) => {
    if (role.escalationTo) requireRole(role.escalationTo, ["workforce", "roles", index, "escalationTo"]);
  });
  config.workforce.approvalHierarchy.forEach((level, index) => {
    requireRole(level.roleId, ["workforce", "approvalHierarchy", index, "roleId"]);
    level.canApproveActions.forEach((action) =>
      requireAction(action, ["workforce", "approvalHierarchy", index, "canApproveActions"]));
  });
  requireRole(config.workforce.delegation.requiresApprovalBy, ["workforce", "delegation", "requiresApprovalBy"]);
  requireRole(config.workforce.reporting.defaultManagerRoleId, ["workforce", "reporting", "defaultManagerRoleId"]);
  config.security.sensitiveFields.forEach((field, index) =>
    field.accessRoles.forEach((role) => requireRole(role, ["security", "sensitiveFields", index, "accessRoles"])));
  config.security.configurationManagement.approvalRoles.forEach((role, index) =>
    requireRole(role, ["security", "configurationManagement", "approvalRoles", index]));

  config.agents.definitions.forEach((agent, index) => {
    agent.policyAccess.forEach((policyRef, refIndex) => {
      if (policyRef !== "*" && policyRef !== "all") requirePolicy(policyRef, ["agents", "definitions", index, "policyAccess", refIndex]);
    });
    agent.approvalRequiredFor.forEach((action) =>
      requireAction(action, ["agents", "definitions", index, "approvalRequiredFor"]));
  });
  if (!config.agents.definitions.some((agent) => agent.enabled)) {
    issue(["agents", "definitions"], "At least one agent must be enabled for an operational tenant");
  }

  requirePolicy(config.payroll.expenses.policyId, ["payroll", "expenses", "policyId"]);
  requireAction(config.payroll.expenses.approvalAction, ["payroll", "expenses", "approvalAction"]);
  requireAction(config.payroll.payPeriods.approvalAction, ["payroll", "payPeriods", "approvalAction"]);
  if (config.payroll.currency.value !== null && !/^[A-Z]{3,8}$/.test(config.payroll.currency.value)) {
    issue(["payroll", "currency", "value"], "Currency must be an uppercase code");
  }
  if (config.payroll.payPeriods.frequency !== timekeeping.payPeriods.frequency) {
    issue(["payroll", "payPeriods", "frequency"], "Payroll and timekeeping pay frequencies must agree");
  }
  if (config.payroll.payPeriods.anchorDate !== timekeeping.payPeriods.anchorDate) {
    issue(["payroll", "payPeriods", "anchorDate"], "Payroll and timekeeping pay-period anchors must agree");
  }
  if (config.payroll.provider.status === "verified" || config.payroll.provider.status === "operational") {
    if (config.payroll.provider.name.value === null) {
      issue(["payroll", "provider", "name"], "A verified payroll provider must be named");
    }
  }

  if (config.status === "active") {
    const unconfirmed = config.hr.policies.filter((policy) =>
      policy.status === "proposed" || policy.status === "requires_confirmation");
    if (unconfirmed.length > 0) {
      issue(["status"], "An active configuration cannot contain unconfirmed policies");
    }
    if (!["verified", "operational"].includes(config.microsoft.health.status)) {
      issue(["status"], "An active configuration requires verified Microsoft connectivity");
    }
    if (!["verified", "operational"].includes(config.communications.health.status)) {
      issue(["status"], "An active configuration requires verified SMS/MMS/voice connectivity");
    }
  }
}

export function validateCompanyConfig(input: unknown): CompanyConfig {
  const parsed = CompanyConfigSchema.parse(input);
  assertNoInlineSecrets(parsed);
  return parsed;
}
