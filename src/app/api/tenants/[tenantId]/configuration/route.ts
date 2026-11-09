import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CompanyConfigurationSchema } from "@/lib/company-configuration";

export const dynamic = "force-dynamic";
const Params = z.object({ tenantId: z.string().uuid() });
const SaveInput = z.object({
  expectedRevision: z.number().int().positive(),
  configuration: CompanyConfigurationSchema
}).strict();

type RouteContext = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const parsed = Params.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid company identifier" }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data, error } = await supabase.from("tenant_configurations")
    .select("tenant_id,schema_version,revision,configuration,updated_at")
    .eq("tenant_id", parsed.data.tenantId).maybeSingle();
  if (error) return NextResponse.json({ error: "Unable to load company configuration" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Company configuration not found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request, context: RouteContext) {
  const parsedParams = Params.safeParse(await context.params);
  if (!parsedParams.success) return NextResponse.json({ error: "Invalid company identifier" }, { status: 400 });

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 1_100_000) {
    return NextResponse.json({ error: "Configuration payload is too large" }, { status: 413 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 1_100_000) {
      return NextResponse.json({ error: "Configuration payload is too large" }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const input = SaveInput.safeParse(body);
  if (!input.success) {
    return NextResponse.json({ error: "Configuration failed schema validation", issues: input.error.issues }, { status: 400 });
  }
  if (input.data.configuration.tenant_id !== parsedParams.data.tenantId) {
    return NextResponse.json({ error: "Configuration tenant does not match request" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("update_company_configuration", {
    p_tenant_id: parsedParams.data.tenantId,
    p_configuration: input.data.configuration,
    p_expected_revision: input.data.expectedRevision
  });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "Company administrator permission required" }, { status: 403 });
    if (error.code === "40001") return NextResponse.json({ error: "Configuration changed elsewhere. Reload before saving." }, { status: 409 });
    return NextResponse.json({ error: "Unable to save company configuration" }, { status: 400 });
  }
  return NextResponse.json({ revision: data }, { headers: { "Cache-Control": "private, no-store" } });
}
