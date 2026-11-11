import type { CompanyConfig } from "@/lib/company-config/schema";
import { assertE164, classifyInboundBody } from "@/lib/integrations/twilio";

export interface InboundMessagingDecision {
  kind: "message" | "opt_out" | "opt_in" | "help";
  channel: "sms" | "mms";
  from: string;
  to: string;
  body: string;
  mediaUrls: string[];
  providerSid: string;
  consentState: "unknown" | "opted_in" | "opted_out";
  reply: string | null;
}

/**
 * Pure inbound-message decision. Tenant resolution and signature verification
 * happen before this function, so a decision can never cross tenant boundaries.
 */
export function decideInboundMessage(
  config: CompanyConfig,
  params: Record<string, string>
): InboundMessagingDecision {
  const from = assertE164(params.From ?? "");
  const to = assertE164(params.To ?? "");
  const configured = config.communications.phoneNumber.e164.value;
  if (configured && configured !== to) {
    throw new Error("Inbound message was addressed to a different company number");
  }
  const providerSid = params.MessageSid?.trim();
  if (!providerSid) throw new Error("Inbound message has no provider SID");
  const mediaCount = Number(params.NumMedia ?? "0");
  const mediaUrls = Array.from({ length: Number.isFinite(mediaCount) ? mediaCount : 0 }, (_, index) =>
    params[`MediaUrl${index}`]
  ).filter((url): url is string => Boolean(url));
  const channel = mediaUrls.length > 0 ? "mms" : "sms";
  const body = (params.Body ?? "").slice(0, 4000);
  const kind = classifyInboundBody(body, config);
  if (kind === "opt_out") {
    return {
      kind, channel, from, to, body, mediaUrls, providerSid,
      consentState: "opted_out",
      reply: config.communications.consent.optOutAcknowledgement
    };
  }
  if (kind === "opt_in") {
    return {
      kind, channel, from, to, body, mediaUrls, providerSid,
      consentState: "opted_in",
      reply: config.communications.consent.confirmationMessage
    };
  }
  if (kind === "help") {
    return {
      kind, channel, from, to, body, mediaUrls, providerSid,
      consentState: "unknown",
      reply: config.communications.consent.helpResponse
    };
  }
  return { kind, channel, from, to, body, mediaUrls, providerSid, consentState: "unknown", reply: null };
}

export function twimlMessage(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

export function emptyTwiml(): string {
  return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>";
}
