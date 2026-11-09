import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createHrsWorkflowService, type HrsWorkflowVerifiers } from "@/lib/hrs-workflows";

/**
 * Construct HRS posting workflows only inside trusted server code.
 * Production callers must provide real schedule and clock-event verifiers.
 * This factory deliberately exposes no browser route or default verifier.
 */
export function createPeopleOsHrsWorkflow(verifiers: HrsWorkflowVerifiers) {
  const admin = createSupabaseAdminClient();
  return createHrsWorkflowService(admin, verifiers);
}
