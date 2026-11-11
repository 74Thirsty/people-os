import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadRepositoryCompanyConfig } from "@/lib/company-config/loader";
import {
  MicrosoftGraphError,
  createMicrosoftGraphClient
} from "./microsoft-graph";
import {
  TwilioError,
  classifyInboundBody,
  computeTwilioSignature,
  createTwilioClient,
  resolveTwilioConfig,
  verifyTwilioSignature
} from "./twilio";

const spin = loadRepositoryCompanyConfig("spin-marketing");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("Microsoft Graph client", () => {
  it("acquires a token, probes the organization, and sends Outlook mail", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/oauth2/v2.0/token")) {
        expect(init?.body?.toString()).toContain("grant_type=client_credentials");
        return jsonResponse({ access_token: "graph-token", expires_in: 3600, token_type: "Bearer" });
      }
      if (url.includes("/organization")) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer graph-token");
        return jsonResponse({ value: [{ id: "org-1", displayName: "Spin Marketing" }] });
      }
      if (url.includes("/mailboxSettings")) {
        return jsonResponse({ timeZone: "America/Chicago" });
      }
      if (url.includes("/sendMail")) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer graph-token");
        return new Response(null, { status: 202 });
      }
      throw new Error(`Unexpected Graph request: ${url}`);
    }) as unknown as typeof fetch;

    const client = createMicrosoftGraphClient(
      { tenantId: "tenant-1", clientId: "client-1", clientSecret: "secret-1" },
      { fetchImpl, now: () => new Date("2026-11-10T12:00:00Z") }
    );
    const health = await client.getConnectionHealth({ mailbox: "hr@example.com" });
    expect(health.status).toBe("verified");
    expect(health.lastCheckedAt).toBe("2026-11-10T12:00:00.000Z");

    await client.sendMail({
      from: "hr@example.com",
      to: ["employee@example.com"],
      subject: "Leave decision",
      text: "Approved."
    });
    const mailCall = calls.find((call) => call.url.includes("/sendMail"));
    expect(mailCall).toBeTruthy();
    const payload = JSON.parse(String(mailCall?.init?.body));
    expect(payload.message.toRecipients[0].emailAddress.address).toBe("employee@example.com");
    expect(payload.saveToSentItems).toBe(true);
  });

  it("requires a temporary password from a secret provider for mailbox provisioning", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = createMicrosoftGraphClient(
      { tenantId: "tenant-1", clientId: "client-1", clientSecret: "secret-1" },
      { fetchImpl }
    );
    await expect(client.provisionEmployeeMailbox({
      userPrincipalName: "employee@example.com",
      displayName: "Employee",
      mailNickname: "employee",
      usageLocation: "US",
      temporaryPassword: ""
    })).rejects.toThrow(/temporary password/);
  });

  it("does not leak the client secret in Graph errors", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/oauth2")) {
        return jsonResponse({ access_token: "token", expires_in: 3600, token_type: "Bearer" }, 200);
      }
      return jsonResponse({ error: { code: "Forbidden", message: "Insufficient privileges" } }, 403);
    }) as unknown as typeof fetch;
    const client = createMicrosoftGraphClient(
      { tenantId: "tenant-1", clientId: "client-1", clientSecret: "do-not-leak" },
      { fetchImpl }
    );
    const error = await client.getConnectionHealth().catch((caught) => caught);
    expect(error).toBeInstanceOf(MicrosoftGraphError);
    expect(String(error.message)).not.toContain("do-not-leak");
  });
});

describe("Twilio messaging and voice client", () => {
  function twilioFetch(capabilities = { sms: true, mms: true, voice: true, fax: false }) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/IncomingPhoneNumbers.json")) {
        return jsonResponse({ incoming_phone_numbers: [{ capabilities }] });
      }
      if (url.includes("/Messages.json")) {
        return jsonResponse({ sid: "SM" + "a".repeat(32), status: "queued" });
      }
      if (url.includes("/Calls.json")) {
        return jsonResponse({ sid: "CA" + "b".repeat(32), status: "queued" });
      }
      if (url.endsWith("/Accounts/AC_fixture.json")) {
        return jsonResponse({ sid: "AC_fixture", status: "active" });
      }
      throw new Error(`Unexpected Twilio request: ${url} ${init?.method ?? "GET"}`);
    }) as unknown as typeof fetch;
  }

  it("sends SMS, MMS with HTTPS media, and voice calls", async () => {
    const fetchImpl = twilioFetch();
    const client = createTwilioClient(
      { accountSid: "AC_fixture", authToken: "token", fromNumber: "+15005550006" },
      { fetchImpl }
    );
    await client.sendSms({ to: "+15005550100", body: "Shift starts at 9." });
    await client.sendMms({
      to: "+15005550100",
      body: "Please review the policy.",
      mediaUrls: ["https://example.com/policy.pdf"]
    });
    await client.sendVoice({ to: "+15005550100", twimlUrl: "https://example.com/twiml/1" });

    const messageCalls = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls
      .filter(([url]) => String(url).includes("/Messages.json"));
    expect(messageCalls).toHaveLength(2);
    const mmsBody = messageCalls[1][1].body as URLSearchParams;
    expect(mmsBody.getAll("MediaUrl")).toEqual(["https://example.com/policy.pdf"]);
    expect(mmsBody.get("From")).toBe("+15005550006");
    const voiceCall = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls
      .find(([url]) => String(url).includes("/Calls.json"));
    expect((voiceCall?.[1].body as URLSearchParams).get("Url")).toBe("https://example.com/twiml/1");
  });

  it("rejects MMS without media and invalid phone numbers", async () => {
    const client = createTwilioClient(
      { accountSid: "AC_fixture", authToken: "token", fromNumber: "+15005550006" },
      { fetchImpl: twilioFetch() }
    );
    await expect(client.sendMms({ to: "+15005550100", body: "x", mediaUrls: [] })).rejects.toBeInstanceOf(TwilioError);
    await expect(client.sendSms({ to: "555-0100", body: "x" })).rejects.toThrow(/E.164/);
  });

  it("validates Twilio webhook signatures with the auth token", () => {
    const authToken = "fixture-auth-token";
    const url = "https://peopleos.example/api/webhooks/twilio";
    const params = { Body: "STOP", From: "+15005550100" };
    const signature = createHmac("sha1", authToken)
      .update(url + "BodySTOP" + "From+15005550100")
      .digest("base64");
    expect(computeTwilioSignature(authToken, url, params)).toBe(signature);
    expect(verifyTwilioSignature({ authToken, url, params, signature })).toBe(true);
    expect(verifyTwilioSignature({ authToken, url, params, signature: "invalid" })).toBe(false);
  });

  it("classifies STOP, HELP, START, and ordinary messages from configuration", () => {
    expect(classifyInboundBody("stop", spin.config)).toBe("opt_out");
    expect(classifyInboundBody("HELP", spin.config)).toBe("help");
    expect(classifyInboundBody("start", spin.config)).toBe("opt_in");
    expect(classifyInboundBody("I need a copy of my schedule", spin.config)).toBe("message");
  });

  it("requires SMS, MMS, and voice capability before reporting verified telephony", async () => {
    const partial = createTwilioClient(
      { accountSid: "AC_fixture", authToken: "token", fromNumber: "+15005550006" },
      {
        fetchImpl: twilioFetch({ sms: true, mms: false, voice: true, fax: false }),
        now: () => new Date("2026-11-10T12:00:00Z")
      }
    );
    const health = await partial.getConnectionHealth("+15005550006");
    expect(health.status).toBe("provisioned");
    expect(health.capabilities.mms).toBe(false);
    expect(health.evidence).toContain("mms=false");
  });

  it("reports missing provisioning values instead of constructing a fake client", () => {
    const resolution = resolveTwilioConfig(spin.config, {});
    expect(resolution.configured).toBe(false);
    expect(resolution.credentials).toBeNull();
    expect(resolution.missing).toContain("TWILIO_PHONE_NUMBER");
  });
});
