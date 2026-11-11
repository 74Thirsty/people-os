import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseActiveConfigStore, createSupabaseIntegrationStore } from "@/lib/company-config/store";
import { createCompanyConfigService } from "@/lib/company-config/service";
import { verifyTwilioSignature } from "@/lib/integrations/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DELIVERY_STATUS = new Set(["queued", "sent", "delivered", "undelivered", "failed", "read"]);

export async function POST(request: Request) {
  try {
    const tenantId = new URL(request.url).searchParams.get("tenantId") ?? "";
    if (!UUID.test(tenantId)) return new NextResponse(null, { status: 400 });
    const form = await request.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of form.entries()) if (typeof value === "string") params[key] = value;

    const admin = createSupabaseAdminClient();
    const resolved = await createCompanyConfigService(createSupabaseActiveConfigStore(admin)).resolveActive(tenantId);
    const authTokenRef = resolved.config.communications.account.authToken.reference.replace(/^env:/, "");
    const authToken = process.env[authTokenRef];
    if (!authToken) return new NextResponse(null, { status: 503 });

    const base = process.env.TWILIO_WEBHOOK_BASE_URL;
    const requestUrl = new URL(request.url);
    const signatureUrl = base
      ? new URL(`/api/webhooks/twilio/status${requestUrl.search}`, base).toString()
      : request.url;
    const signature = request.headers.get("x-twilio-signature") ?? "";
    if (!verifyTwilioSignature({ authToken, url: signatureUrl, params, signature })) {
      return new NextResponse(null, { status: 403 });
    }

    const sid = params.MessageSid ?? "";
    if (!sid) return new NextResponse(null, { status: 400 });
    const status = DELIVERY_STATUS.has(params.MessageStatus ?? "") ? params.MessageStatus : "failed";
    await createSupabaseIntegrationStore(admin).updateMessageStatus({
      tenantId,
      providerSid: sid,
      status: status as string,
      errorCode: params.ErrorCode || null
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Twilio status webhook failed", error);
    return new NextResponse(null, { status: 500 });
  }
}
