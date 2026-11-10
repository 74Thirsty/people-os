import { z } from "zod";

const nullableText = z.string().trim().max(500).nullable().optional();
const contactSchema = z.object({
  primary_email: z.string().email().max(254).nullable().optional(),
  primary_phone: z.string().max(40).nullable().optional(),
  hr_email: z.string().email().max(254).nullable().optional(),
  hr_phone: z.string().max(40).nullable().optional(),
  payroll_email: z.string().email().max(254).nullable().optional(),
  payroll_phone: z.string().max(40).nullable().optional(),
  emergency_phone: z.string().max(40).nullable().optional(),
  communication_preferences: z.object({
    email: z.boolean(), sms: z.boolean(), voice: z.boolean()
  }).strict()
}).strict();

const personSchema = z.object({
  id: z.string().uuid().optional(),
  user_id: z.string().uuid().nullable().optional(),
  employee_id: z.string().uuid().nullable().optional(),
  employee_number: z.string().trim().max(80).nullable().optional(),
  legal_first_name: z.string().trim().min(1).max(100),
  legal_last_name: z.string().trim().min(1).max(100),
  preferred_name: nullableText,
  email: z.string().email().max(254).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  address: z.object({
    street: nullableText, suite: nullableText, city: nullableText,
    state: nullableText, postal_code: nullableText, country: z.string().max(2).nullable().optional()
  }).strict().optional(),
  emergency_contacts: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    relationship: z.string().max(80).nullable().optional(),
    phone: z.string().max(40),
    email: z.string().email().max(254).nullable().optional()
  }).strict()).max(5).optional(),
  department: nullableText,
  job_title: nullableText,
  employment_status: z.enum(["pending","active","leave","terminated"]).optional(),
  hire_date: z.string().date().nullable().optional(),
  manager_id: z.string().uuid().nullable().optional(),
  assigned_permissions: z.array(z.string().max(120)).max(100).optional(),
  compensation_config_reference: z.string().max(200).nullable().optional(),
  scheduling_config: z.record(z.string(), z.unknown()).optional(),
  hrs_wallet_reference: z.string().max(200).nullable().optional(),
  document_references: z.array(z.string().max(500)).max(100).optional()
}).strict();

const roleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  permissions: z.array(z.string().trim().min(1).max(120)).max(200)
}).strict();

const companyConfigurationBaseSchema = z.object({
  schema_version: z.literal("1.0.0"),
  tenant_id: z.string().uuid(),
  company: z.object({
    legal_name: z.string().trim().min(2).max(200),
    display_name: z.string().trim().min(2).max(120),
    business_type: nullableText,
    industry: nullableText,
    website: z.string().url().max(500).nullable().optional(),
    address: z.object({
      street: nullableText, suite: nullableText, city: nullableText,
      state: nullableText, postal_code: nullableText, country: z.string().max(2).nullable()
    }).strict(),
    timezone: z.string().trim().min(1).max(100),
    jurisdictions: z.array(z.string().trim().min(2).max(100)).max(100)
  }).strict(),
  contact: contactSchema,
  administrators: z.array(personSchema).max(100),
  managers: z.array(personSchema).max(1000),
  employees: z.array(personSchema).max(10000),
  permissions: z.object({
    roles: z.array(roleSchema).max(100),
    custom_permissions: z.array(z.string().trim().min(1).max(120)).max(500),
    approval_hierarchy: z.array(z.object({
      action: z.string().trim().min(1).max(120),
      approver_role: z.string().trim().min(1).max(80),
      required_approvals: z.number().int().min(1).max(10)
    }).strict()).max(200)
  }).strict(),
  policies: z.object({
    employee_handbook: z.object({version: nullableText,document_reference: nullableText}).strict(),
    attendance: z.record(z.string(),z.unknown()),
    scheduling: z.record(z.string(),z.unknown()),
    overtime: z.record(z.string(),z.unknown()),
    leave: z.record(z.string(),z.unknown()),
    holidays: z.record(z.string(),z.unknown()),
    breaks: z.record(z.string(),z.unknown()),
    disciplinary: z.record(z.string(),z.unknown()),
    termination: z.record(z.string(),z.unknown())
  }).strict(),
  payroll: z.object({
    frequency: z.enum(["weekly","biweekly","semimonthly","monthly"]).nullable(),
    workweek_start: z.number().int().min(0).max(6).nullable(),
    currency: z.string().length(3),
    provider_reference: nullableText,
    tax_configuration_reference: nullableText
  }).strict(),
  integrations: z.object({
    email: z.record(z.string(),z.unknown()), sms: z.record(z.string(),z.unknown()),
    voice: z.record(z.string(),z.unknown()), accounting: z.record(z.string(),z.unknown()),
    payroll: z.record(z.string(),z.unknown())
  }).strict(),
  agents: z.object({
    hr_manager: z.record(z.string(),z.unknown()),
    payroll_agent: z.record(z.string(),z.unknown()),
    scheduling_agent: z.record(z.string(),z.unknown()),
    employee_support_agent: z.record(z.string(),z.unknown())
  }).strict(),
  hrs: z.object({
    enabled: z.boolean(),
    custody_mode: z.literal("peopleos_custody"),
    employee_wallet_access: z.literal(false)
  }).strict(),
  audit: z.object({
    configuration_version: z.number().int().positive()
  }).strict()
}).strict();



// Configuration documents may contain references to protected resources, never
// credentials or regulated identifiers themselves. Apply recursively so nested
// policy/provider/agent objects cannot smuggle secrets into the JSON document.
const forbiddenConfigurationKey = /^(password|passwd|secret|clientsecret|apikey|apitoken|accesstoken|refreshtoken|authorization|privatekey|seedphrase|mnemonic|bankaccount(number)?|routing(number)?|taxid|ssn|socialsecurity(number)?)$/i;

function findForbiddenConfigurationKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenConfigurationKeys(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => {
      const normalized = key.replace(/[^a-z0-9]/gi, "");
      const here = forbiddenConfigurationKey.test(normalized) ? [`${path}.${key}`] : [];
      return [...here, ...findForbiddenConfigurationKeys(child, `${path}.${key}`)];
    });
  }
  return [];
}

export const CompanyConfigurationSchema = companyConfigurationBaseSchema.superRefine((configuration, context) => {
  for (const path of findForbiddenConfigurationKeys(configuration)) {
    context.addIssue({
      code: "custom",
      path: path.replace(/^\$\.?/, "").split(/[.\[\]]+/).filter(Boolean),
      message: "Store secrets and regulated identifiers in protected vaults, not company configuration."
    });
  }
});

export type CompanyConfiguration = z.infer<typeof CompanyConfigurationSchema>;
