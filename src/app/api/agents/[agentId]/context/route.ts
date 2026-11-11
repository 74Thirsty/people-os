import { AgentContextError, resolveAgentContext } from "@/lib/company-config/agents";
import { errorResponse, HttpError, loadTenantPrincipal } from "@/lib/company-config/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await context.params;
    const tenantId = new URL(request.url).searchParams.get("tenantId");
    if (!tenantId) throw new HttpError(400, "tenantId is required");
    const principal = await loadTenantPrincipal(tenantId, "company.configuration.read");
    try {
      const resolved = resolveAgentContext(principal.config, agentId);
      return Response.json(resolved);
    } catch (error) {
      if (error instanceof AgentContextError) throw new HttpError(404, error.message);
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
