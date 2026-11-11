import { NextResponse } from "next/server";
import { ConfigEditSchema, applyConfigEdit, configurationChangeSummary } from "@/lib/company-config/admin";
import { hashCompanyConfig, validateCompanyConfigDocument } from "@/lib/company-config/loader";
import { evaluateReadiness } from "@/lib/company-config/readiness";
import {
  errorResponse,
  loadTenantPrincipal,
  readJsonBody,
  readinessResponse
} from "@/lib/company-config/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await context.params;
    const principal = await loadTenantPrincipal(tenantId, "company.configuration.read");
    const integrations = await principal.integrationStore.loadStatuses(tenantId);
    const readiness = evaluateReadiness(principal.config, { env: process.env, integrations });
    return readinessResponse(principal.resolved, readiness, integrations);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await context.params;
    const principal = await loadTenantPrincipal(tenantId, "company.configuration.write");
    const body = await readJsonBody(request);
    const edit = ConfigEditSchema.parse(body);
    const updated = applyConfigEdit(principal.config, edit, { userId: principal.user.id });
    const config = validateCompanyConfigDocument(updated);
    const hash = hashCompanyConfig(config);

    const { error } = await principal.admin.rpc("publish_tenant_config_version", {
      p_tenant_id: tenantId,
      p_version: config.configVersion,
      p_content_hash: hash,
      p_config: config,
      p_source: "admin",
      p_created_by: principal.user.id,
      p_change_summary: configurationChangeSummary(edit)
    });
    if (error) throw new Error(`Unable to publish configuration: ${error.message}`);

    const integrations = await principal.integrationStore.loadStatuses(tenantId);
    const readiness = evaluateReadiness(config, { env: process.env, integrations });
    return NextResponse.json({
      tenantId,
      version: config.configVersion,
      hash,
      readiness,
      integrations
    });
  } catch (error) {
    return errorResponse(error);
  }
}
