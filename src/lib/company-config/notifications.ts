import type { CompanyConfig } from "./schema";

export type NotificationEvent = keyof CompanyConfig["communications"]["notifications"];

export interface NotificationRoute {
  event: NotificationEvent;
  configuredChannels: string[];
  availableChannels: string[];
  recipients: string[];
  requiresConsent: boolean;
}

export class NotificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationError";
  }
}

/**
 * Resolves the communication route from the active tenant configuration and
 * only exposes channels whose capability was verified on the provisioned number.
 */
export function resolveNotificationRoute(
  config: CompanyConfig,
  event: NotificationEvent
): NotificationRoute {
  const rule = config.communications.notifications[event];
  if (!rule) throw new NotificationError(`Unknown notification event: ${event}`);
  const capabilities = config.communications.phoneNumber.verifiedCapabilities;
  const availableChannels = rule.channels.filter((channel) => {
    if (channel === "sms") return capabilities.sms;
    if (channel === "mms") return capabilities.mms;
    if (channel === "voice") return capabilities.voice;
    return false;
  });
  return {
    event,
    configuredChannels: [...rule.channels],
    availableChannels,
    recipients: [...rule.recipients],
    requiresConsent: rule.requiresConsent
  };
}

export interface NotificationSender {
  sendSms(input: { to: string; body: string }): Promise<{ sid: string; status: string }>;
  sendMms(input: { to: string; body: string; mediaUrls: string[] }): Promise<{ sid: string; status: string }>;
  sendVoice(input: { to: string; twimlUrl: string }): Promise<{ sid: string; status: string }>;
}

export interface NotificationResult {
  event: NotificationEvent;
  channel: "sms" | "mms" | "voice";
  providerSid: string;
  status: string;
}

export async function sendConfiguredNotification(input: {
  config: CompanyConfig;
  event: NotificationEvent;
  to: string;
  body: string;
  consent: "unknown" | "opted_in" | "opted_out";
  mediaUrls?: string[];
  twimlUrl?: string;
  sender: NotificationSender;
}): Promise<NotificationResult> {
  const route = resolveNotificationRoute(input.config, input.event);
  if (route.requiresConsent && input.consent !== "opted_in") {
    throw new NotificationError("Recipient has not opted in to company messaging");
  }
  if (route.availableChannels.length === 0) {
    throw new NotificationError("No verified communication channel is available for this notification");
  }

  if (route.availableChannels.includes("mms") && input.mediaUrls && input.mediaUrls.length > 0) {
    const result = await input.sender.sendMms({ to: input.to, body: input.body, mediaUrls: input.mediaUrls });
    return { event: input.event, channel: "mms", providerSid: result.sid, status: result.status };
  }
  if (route.availableChannels.includes("sms")) {
    const result = await input.sender.sendSms({ to: input.to, body: input.body });
    return { event: input.event, channel: "sms", providerSid: result.sid, status: result.status };
  }
  if (route.availableChannels.includes("voice")) {
    if (!input.twimlUrl) throw new NotificationError("Voice notification requires a TwiML URL");
    const result = await input.sender.sendVoice({ to: input.to, twimlUrl: input.twimlUrl });
    return { event: input.event, channel: "voice", providerSid: result.sid, status: result.status };
  }
  throw new NotificationError("No supported delivery channel is configured for this notification");
}
