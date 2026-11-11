import { z } from "zod";
import { activateTenant, suspendTenant } from "@/lib/company-config/onboarding";
import { createSupabaseOnboardingStore } from "@/lib/company-config/store";
import {
  errorResponse,
  loadTenantPrincipal,
  readJsonBody
} from "@/lib/company-config/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StatusInput = z.object({ action: z.enum(["activate", "suspend"]) }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await context.params;
    const principal = await loadTenantPrincipal(tenantId, "tenant.status.manage");
    const input = StatusInput.parse(await readJsonBody(request, 2048));
    const store = createSupabaseOnboardingStore(principal.admin);
    const integrations = await principal.integrationStore.loadStatuses(tenantId);

    if (input.action === "activate") {
      const readiness = await activateTenant(store, {
        tenantId,
        config: principal.config,
        actorUserId: principal.user.id,
        env: process.env,
        integrations
      });
      return Response.json({ status: "active", readiness });
    }

    await suspendTenant(store, { tenantId, actorUserId: principal.user.id });
    return Response.json({ status: "suspended" });
  } catch (error) {
    return errorResponse(error);
  }
}
