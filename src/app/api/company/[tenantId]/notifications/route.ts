import { z } from "zod";
import { createTwilioClient, resolveTwilioConfig } from "@/lib/integrations/twilio";
import {
  NotificationError,
  sendConfiguredNotification,
  type NotificationEvent
} from "@/lib/company-config/notifications";
import {
  errorResponse,
  HttpError,
  loadTenantPrincipal,
  readJsonBody
} from "@/lib/company-config/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NotificationInput = z.object({
  event: z.enum(["shiftReminder", "attendanceEscalation", "leaveDecision", "payrollApproval", "urgentSafety", "scheduleChange"]),
  to: z.string().regex(/^\+[1-9]\d{7,14}$/),
  body: z.string().trim().min(1).max(1600),
  mediaUrls: z.array(z.string().url()).max(10).optional(),
  twimlUrl: z.string().url().optional()
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await context.params;
    const principal = await loadTenantPrincipal(tenantId, "messaging.send");
    const input = NotificationInput.parse(await readJsonBody(request, 16_384));
    const consent = await principal.integrationStore.getConsent(tenantId, input.to);
    if (consent === "opted_out") throw new HttpError(409, "Recipient has opted out of company messaging");

    const twilio = resolveTwilioConfig(principal.config, process.env);
    if (!twilio.configured || !twilio.credentials) {
      throw new HttpError(503, `Telephony is not provisioned: ${twilio.missing.join(", ")}`);
    }
    const client = createTwilioClient(twilio.credentials);
    const result = await sendConfiguredNotification({
      config: principal.config,
      event: input.event as NotificationEvent,
      to: input.to,
      body: input.body,
      consent,
      mediaUrls: input.mediaUrls,
      twimlUrl: input.twimlUrl,
      sender: client
    });

    await principal.admin.from("tenant_messages").upsert({
      tenant_id: tenantId,
      provider_sid: result.providerSid,
      direction: "outbound",
      channel: result.channel,
      from_e164: twilio.credentials.fromNumber ?? null,
      to_e164: input.to,
      body: input.body,
      media_urls: input.mediaUrls ?? [],
      status: ["queued", "sent", "delivered", "undelivered", "failed", "read"].includes(result.status)
        ? result.status
        : "queued",
      metadata: { event: input.event }
    }, { onConflict: "tenant_id,provider_sid", ignoreDuplicates: true });

    await principal.admin.from("audit_events").insert({
      tenant_id: tenantId,
      actor_user_id: principal.user.id,
      actor_type: "administrator",
      event_type: "notification.sent",
      subject_type: "message",
      source_channel: result.channel === "voice" ? "voice" : "sms",
      source_reference: result.providerSid,
      payload: { event: input.event, channel: result.channel }
    });
    return Response.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof NotificationError) {
      return errorResponse(new HttpError(400, error.message));
    }
    return errorResponse(error);
  }
}
