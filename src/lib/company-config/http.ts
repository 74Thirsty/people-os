import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CompanyConfigValidationError } from "./loader";
import { AuthorizationError } from "./access";
import {
  CompanyConfigAccessError,
  CompanyConfigIntegrityError,
  CompanyConfigNotFoundError,
  createCompanyConfigService,
  type ResolvedTenantConfig
} from "./service";
import {
  createSupabaseActiveConfigStore,
  createSupabaseIntegrationStore,
  createSupabaseMembershipStore
} from "./store";
import { roleHasPermission } from "./access";
import { TenantActivationBlockedError, TenantOnboardingError } from "./onboarding";

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function authenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new HttpError(401, "Authentication required");
  return { supabase, user };
}

export async function loadTenantPrincipal(tenantId: string, permission: string) {
  if (!UUID.test(tenantId)) throw new HttpError(400, "Invalid tenant identifier");
  const { supabase, user } = await authenticatedUser();
  const membership = await createSupabaseMembershipStore(supabase).loadMembership(tenantId, user.id);
  if (!membership) throw new HttpError(403, "Tenant access denied");
  const admin = createSupabaseAdminClient();
  const service = createCompanyConfigService(
    createSupabaseActiveConfigStore(admin),
    createSupabaseMembershipStore(supabase)
  );
  const resolved = await service.resolveForMembership(tenantId, user.id);
  if (!resolved.role || !roleHasPermission(resolved.role, permission)) {
    throw new HttpError(403, `The tenant role does not have ${permission}`);
  }
  return {
    tenantId,
    user,
    supabase,
    admin,
    membershipRole: resolved.membershipRole,
    resolved,
    config: resolved.config,
    integrationStore: createSupabaseIntegrationStore(admin)
  };
}

export async function readJsonBody(request: Request, maxBytes = 64_000): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, "Request body is too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new HttpError(413, "Request body is too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Invalid request", issues: error.issues.map((issue) => issue.message) }, { status: 400 });
  }
  if (error instanceof CompanyConfigValidationError) {
    return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 });
  }
  if (error instanceof TenantActivationBlockedError) {
    return NextResponse.json({ error: error.message, blockers: error.blockers }, { status: 409 });
  }
  if (error instanceof TenantOnboardingError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof AuthorizationError || error instanceof CompanyConfigAccessError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof CompanyConfigNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof CompanyConfigIntegrityError) {
    return NextResponse.json({ error: "Tenant configuration failed integrity verification" }, { status: 409 });
  }
  console.error("PeopleOS configuration request failed", error);
  return NextResponse.json({ error: "Unable to complete the configuration request" }, { status: 500 });
}

export function readinessResponse(
  resolved: ResolvedTenantConfig,
  readiness: unknown,
  integrations: unknown
): NextResponse {
  return NextResponse.json({
    tenantId: resolved.tenantId,
    version: resolved.version,
    hash: resolved.hash,
    config: resolved.config,
    readiness,
    integrations
  });
}
