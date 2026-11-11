import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadRepositoryCompanyConfig } from "@/lib/company-config/loader";
import { provisionTenantFromConfig } from "@/lib/company-config/onboarding";
import { createSupabaseOnboardingStore } from "@/lib/company-config/store";
import {
  HttpError,
  authenticatedUser,
  errorResponse,
  readJsonBody
} from "@/lib/company-config/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OnboardingInput = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,48}$/)
}).strict();

function platformAdmins(): string[] {
  return (process.env.PEOPLEOS_PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function POST(request: Request) {
  try {
    const { user } = await authenticatedUser();
    const allowlist = platformAdmins();
    if (allowlist.length === 0) {
      throw new HttpError(403, "Platform onboarding is disabled until PEOPLEOS_PLATFORM_ADMIN_EMAILS is configured");
    }
    if (!user.email || !allowlist.includes(user.email.toLowerCase())) {
      throw new HttpError(403, "Platform administrator authorization is required");
    }
    const input = OnboardingInput.parse(await readJsonBody(request, 2048));
    const loaded = loadRepositoryCompanyConfig(input.slug);
    const store = createSupabaseOnboardingStore(createSupabaseAdminClient());
    const result = await provisionTenantFromConfig(store, loaded, {
      actorUserId: user.id,
      env: process.env,
      allowDraft: false
    });
    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
