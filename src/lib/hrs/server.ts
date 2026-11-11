import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createHrsWorkflowService, type HrsWorkflowVerifiers } from "@/lib/hrs-workflows";
import type { CompanyConfig } from "@/lib/company-config/schema";
import { createConfiguredHrsVerifiers } from "@/lib/hrs/company-config-guard";

/**
 * Construct HRS posting workflows only inside trusted server code.
 * When an active company configuration is supplied, schedule authorization is
 * additionally constrained by the tenant's configured approval authority.
 * Production callers must still provide real schedule and clock-event verifiers.
 */
export function createPeopleOsHrsWorkflow(
  verifiers: HrsWorkflowVerifiers,
  options?: { config: CompanyConfig; approverRoleId: string }
) {
  const admin = createSupabaseAdminClient();
  const effective = options
    ? createConfiguredHrsVerifiers(options.config, options.approverRoleId, verifiers)
    : verifiers;
  return createHrsWorkflowService(admin, effective);
}
