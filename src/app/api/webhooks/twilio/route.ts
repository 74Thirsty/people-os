import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseActiveConfigStore, createSupabaseIntegrationStore } from "@/lib/company-config/store";
import { createCompanyConfigService } from "@/lib/company-config/service";
import { verifyTwilioSignature } from "@/lib/integrations/twilio";
import { decideInboundMessage, emptyTwiml, twimlMessage } from "@/lib/messaging/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const E164 = /^\+[1-9]\d{7,14}$/;

function formParams(form: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}

function twilioSignatureUrl(request: Request, path: string): string {
  const base = process.env.TWILIO_WEBHOOK_BASE_URL;
  if (!base) return request.url;
  const requestUrl = new URL(request.url);
  return new URL(`${path}${requestUrl.search}`, base).toString();
}

function xml(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" }
  });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const params = formParams(form);
    const to = params.To ?? "";
    if (!E164.test(to)) return xml(emptyTwiml(), 400);

    const admin = createSupabaseAdminClient();
    const integrationStore = createSupabaseIntegrationStore(admin);
    const tenantId = await integrationStore.resolveTenantByPhone(to);
    if (!tenantId) return xml(emptyTwiml(), 404);

    const configService = createCompanyConfigService(createSupabaseActiveConfigStore(admin));
    const resolved = await configService.resolveActive(tenantId);
    const authTokenRef = resolved.config.communications.account.authToken.reference.replace(/^env:/, "");
    const authToken = process.env[authTokenRef];
    if (!authToken) return xml(emptyTwiml(), 503);

    const signature = request.headers.get("x-twilio-signature") ?? "";
    const signatureUrl = twilioSignatureUrl(request, "/api/webhooks/twilio");
    if (!verifyTwilioSignature({ authToken, url: signatureUrl, params, signature })) {
      return xml(emptyTwiml(), 403);
    }

    const decision = decideInboundMessage(resolved.config, params);
    await integrationStore.recordInboundMessage({
      tenantId,
      providerSid: decision.providerSid,
      channel: decision.channel,
      fromE164: decision.from,
      toE164: decision.to,
      body: decision.body,
      mediaUrls: decision.mediaUrls
    });

    if (decision.consentState !== "unknown") {
      await integrationStore.setConsent({
        tenantId,
        phoneE164: decision.from,
        state: decision.consentState,
        source: `twilio_inbound:${decision.providerSid}`
      });
      await admin.from("audit_events").insert({
        tenant_id: tenantId,
        actor_type: "provider",
        event_type: "messaging.consent.changed",
        subject_type: "messaging_contact",
        subject_id: null,
        source_channel: "sms",
        source_reference: decision.providerSid,
        payload: { consentState: decision.consentState, channel: decision.channel }
      });
    }

    return xml(decision.reply ? twimlMessage(decision.reply) : emptyTwiml());
  } catch (error) {
    console.error("Twilio inbound webhook failed", error);
    return xml(emptyTwiml(), 500);
  }
}
