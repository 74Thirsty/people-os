import { describe, expect, it } from "vitest";
import { CompanyConfigurationSchema } from "./company-configuration";

const validConfiguration = {
  schema_version: "1.0.0",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  company: {
    legal_name: "Example Company LLC", display_name: "Example",
    business_type: null, industry: null, website: null,
    address: {street:null,suite:null,city:null,state:null,postal_code:null,country:"US"},
    timezone: "America/Chicago", jurisdictions: []
  },
  contact: {
    primary_email: "hello@example.com", primary_phone: "+15555550100",
    hr_email: null, hr_phone: null, payroll_email: null, payroll_phone: null,
    emergency_phone: null,
    communication_preferences: {email:true,sms:false,voice:false}
  },
  administrators: [], managers: [], employees: [],
  permissions: {
    roles: [{name:"owner",permissions:["*"]}],
    custom_permissions: [], approval_hierarchy: []
  },
  policies: {
    employee_handbook:{version:null,document_reference:null},
    attendance:{},scheduling:{},overtime:{},leave:{},holidays:{},
    breaks:{},disciplinary:{},termination:{}
  },
  payroll: {
    frequency:null,workweek_start:null,currency:"USD",
    provider_reference:null,tax_configuration_reference:null
  },
  integrations:{email:{},sms:{},voice:{},accounting:{},payroll:{}},
  agents:{hr_manager:{},payroll_agent:{},scheduling_agent:{},employee_support_agent:{}},
  hrs:{enabled:false,custody_mode:"peopleos_custody",employee_wallet_access:false},
  audit:{configuration_version:1}
};

describe("CompanyConfigurationSchema", () => {
  it("accepts a complete company configuration", () => {
    expect(CompanyConfigurationSchema.safeParse(validConfiguration).success).toBe(true);
  });

  it("rejects nested secret and regulated-identifier keys", () => {\n    const configuration = validConfiguration();\n    configuration.integrations.payroll = { api_key: "must-not-be-stored" };\n    expect(CompanyConfigurationSchema.safeParse(configuration).success).toBe(false);\n  });\n\n  it("rejects employee wallet access", () => {
    const unsafe = {
      ...validConfiguration,
      hrs: {...validConfiguration.hrs, employee_wallet_access:true}
    };
    expect(CompanyConfigurationSchema.safeParse(unsafe).success).toBe(false);
  });

  it("rejects unknown properties so secrets cannot be silently added", () => {
    const unsafe = {...validConfiguration, service_role_key:"do-not-store"};
    expect(CompanyConfigurationSchema.safeParse(unsafe).success).toBe(false);
  });

  it("requires the tenant identifier and a valid contact email", () => {
    const unsafe = {
      ...validConfiguration, tenant_id:"not-a-uuid",
      contact:{...validConfiguration.contact,primary_email:"not-an-email"}
    };
    expect(CompanyConfigurationSchema.safeParse(unsafe).success).toBe(false);
  });
});
