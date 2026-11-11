import { createHmac, timingSafeEqual } from "node:crypto";
import type { CompanyConfig } from "@/lib/company-config/schema";

/**
 * Twilio messaging and voice client. The provider must support SMS, MMS, and
 * voice. A number is not operational until a live capability lookup succeeds.
 */

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  fromNumber?: string | null;
  messagingServiceSid?: string | null;
}

export interface TwilioOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
  timeoutMs?: number;
  now?: () => Date;
}

export class TwilioError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "TwilioError";
    this.status = status;
  }
}

export interface TwilioMessageResult {
  sid: string;
  status: string;
  direction?: string;
  to?: string;
  from?: string;
}

export interface TwilioCapabilities {
  sms: boolean;
  mms: boolean;
  voice: boolean;
  fax: boolean;
}

const E164 = /^\+[1-9]\d{7,14}$/;

export function assertE164(phoneNumber: string): string {
  if (!E164.test(phoneNumber)) throw new TwilioError("Phone number must be E.164");
  return phoneNumber;
}

export function assertMediaUrls(urls: string[]): string[] {
  if (urls.length === 0) throw new TwilioError("MMS requires at least one media URL");
  for (const url of urls) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new TwilioError("MMS media URL is invalid"); }
    if (parsed.protocol !== "https:") throw new TwilioError("MMS media URLs must use HTTPS");
  }
  return urls;
}

/** Twilio request validation: HMAC-SHA1 over URL + sorted parameter name/value pairs. */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>
): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((value, key) => value + key + params[key], url);
  return createHmac("sha1", authToken).update(payload).digest("base64");
}

export function verifyTwilioSignature(input: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string;
}): boolean {
  if (!input.authToken || !input.signature) return false;
  const expected = Buffer.from(computeTwilioSignature(input.authToken, input.url, input.params));
  const provided = Buffer.from(input.signature);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export function classifyInboundBody(body: string, config: CompanyConfig): "opt_out" | "opt_in" | "help" | "message" {
  const normalized = body.trim().toUpperCase();
  const keywords = (list: string[]) => list.some((keyword) => keyword.toUpperCase() === normalized);
  if (keywords(config.communications.consent.optOutKeywords)) return "opt_out";
  if (keywords(config.communications.consent.optInKeywords)) return "opt_in";
  if (keywords(config.communications.consent.helpKeywords)) return "help";
  return "message";
}

export function createTwilioClient(credentials: TwilioCredentials, options: TwilioOptions = {}) {
  const accountSid = credentials.accountSid.trim();
  const authToken = credentials.authToken.trim();
  if (!accountSid || !authToken) throw new TwilioError("Twilio account SID and auth token are required");
  if (!accountSid.startsWith("AC")) throw new TwilioError("Twilio account SID format is invalid");
  const fromNumber = credentials.fromNumber ? assertE164(credentials.fromNumber) : null;
  const messagingServiceSid = credentials.messagingServiceSid?.trim() || null;
  if (!fromNumber && !messagingServiceSid) {
    throw new TwilioError("A verified sender number or messaging service SID is required");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBaseUrl = options.apiBaseUrl ?? "https://api.twilio.com";
  const timeoutMs = options.timeoutMs ?? 20_000;
  const now = options.now ?? (() => new Date());
  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("authorization", authHeader);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/x-www-form-urlencoded");
    }
    const response = await fetchImpl(`${apiBaseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    if (!response.ok) {
      let message = `Twilio request failed with status ${response.status}`;
      try {
        const parsed = JSON.parse(text) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        // Do not echo raw provider responses.
      }
      throw new TwilioError(message, response.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  function messageBody(input: {
    to: string;
    body: string;
    mediaUrls?: string[];
    statusCallback?: string;
  }): URLSearchParams {
    const to = assertE164(input.to);
    const body = new URLSearchParams({ To: to, Body: input.body });
    if (fromNumber) body.set("From", fromNumber);
    if (messagingServiceSid) body.set("MessagingServiceSid", messagingServiceSid);
    if (input.statusCallback) body.set("StatusCallback", input.statusCallback);
    if (input.mediaUrls) {
      for (const url of assertMediaUrls(input.mediaUrls)) body.append("MediaUrl", url);
    }
    return body;
  }

  async function lookupNumberCapabilities(phoneNumber: string) {
    const e164 = assertE164(phoneNumber);
    const query = new URLSearchParams({ PhoneNumber: e164 });
    const response = await request<{
      incoming_phone_numbers?: Array<{ capabilities?: Partial<TwilioCapabilities> }>;
    }>(`/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?${query.toString()}`);
    const capabilities = response.incoming_phone_numbers?.[0]?.capabilities;
    return {
      sms: capabilities?.sms === true,
      mms: capabilities?.mms === true,
      voice: capabilities?.voice === true,
      fax: capabilities?.fax === true
    } satisfies TwilioCapabilities;
  }

  async function getConnectionHealth(phoneNumber: string) {
    const account = await request<{ sid: string; status: string }>(
      `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`
    );
    const capabilities = await lookupNumberCapabilities(phoneNumber);
    const verified = account.status === "active" && capabilities.sms && capabilities.mms && capabilities.voice;
    return {
      status: verified ? "verified" as const : "provisioned" as const,
      lastCheckedAt: now().toISOString(),
      evidence: `Twilio account ${account.status}; number capabilities sms=${capabilities.sms} mms=${capabilities.mms} voice=${capabilities.voice}`,
      capabilities
    };
  }

  return Object.freeze({
    async sendSms(input: { to: string; body: string; statusCallback?: string }) {
      return request<TwilioMessageResult>(
        `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
        { method: "POST", body: messageBody({ ...input, body: input.body }) }
      );
    },

    async sendMms(input: { to: string; body: string; mediaUrls: string[]; statusCallback?: string }) {
      return request<TwilioMessageResult>(
        `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
        { method: "POST", body: messageBody({ ...input, body: input.body }) }
      );
    },

    async sendVoice(input: { to: string; twimlUrl: string }) {
      const to = assertE164(input.to);
      if (!fromNumber) throw new TwilioError("Voice calls require a provisioned sender number");
      let twiml: URL;
      try { twiml = new URL(input.twimlUrl); } catch { throw new TwilioError("TwiML URL is invalid"); }
      if (twiml.protocol !== "https:") throw new TwilioError("TwiML URL must use HTTPS");
      return request<{ sid: string; status: string }>(
        `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`,
        {
          method: "POST",
          body: new URLSearchParams({ To: to, From: fromNumber, Url: input.twimlUrl })
        }
      );
    },

    async getMessage(sid: string) {
      if (!/^(SM|MM)[0-9a-f]{32}$/i.test(sid)) throw new TwilioError("Twilio message SID format is invalid");
      return request<TwilioMessageResult>(
        `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(sid)}.json`
      );
    },

    lookupNumberCapabilities,
    getConnectionHealth,

    verifyWebhookSignature(input: {
      url: string;
      params: Record<string, string>;
      signature: string;
    }) {
      return verifyTwilioSignature({ authToken, ...input });
    }
  });
}

export interface TwilioConfigResolution {
  configured: boolean;
  missing: string[];
  credentials: TwilioCredentials | null;
}

export function resolveTwilioConfig(
  config: CompanyConfig,
  env: Record<string, string | undefined>
): TwilioConfigResolution {
  const accountSid = config.communications.account.accountSid.value ?? env.TWILIO_ACCOUNT_SID ?? null;
  const fromNumber = config.communications.phoneNumber.e164.value ?? env.TWILIO_PHONE_NUMBER ?? null;
  const messagingServiceSid =
    config.communications.account.messagingServiceSid.value ?? env.TWILIO_MESSAGING_SERVICE_SID ?? null;
  const secretRef = config.communications.account.authToken.reference.replace(/^env:/, "");
  const authToken = env[secretRef] ?? null;
  const missing: string[] = [];
  if (!accountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!authToken) missing.push("TWILIO_AUTH_TOKEN");
  if (!fromNumber) missing.push("TWILIO_PHONE_NUMBER");
  if (missing.length > 0) return { configured: false, missing, credentials: null };
  return {
    configured: true,
    missing: [],
    credentials: { accountSid: accountSid as string, authToken: authToken as string, fromNumber, messagingServiceSid }
  };
}
