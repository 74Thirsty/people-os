import { describe, expect, it, vi } from "vitest";
import { loadRepositoryCompanyConfig } from "./loader";
import {
  NotificationError,
  resolveNotificationRoute,
  sendConfiguredNotification
} from "./notifications";
import type { CompanyConfig } from "./schema";

const spin = loadRepositoryCompanyConfig("spin-marketing");
const example = loadRepositoryCompanyConfig("example-tenant");

function sender() {
  return {
    sendSms: vi.fn().mockResolvedValue({ sid: `SM${"a".repeat(32)}`, status: "queued" }),
    sendMms: vi.fn().mockResolvedValue({ sid: `MM${"b".repeat(32)}`, status: "queued" }),
    sendVoice: vi.fn().mockResolvedValue({ sid: `CA${"c".repeat(32)}`, status: "queued" })
  };
}

describe("configuration-driven notifications", () => {
  it("uses the configured recipients and refuses channels that are not verified", () => {
    const route = resolveNotificationRoute(spin.config, "attendanceEscalation");
    expect(route.recipients).toEqual(["manager", "supervisor"]);
    expect(route.configuredChannels).toEqual(["sms", "voice"]);
    expect(route.availableChannels).toEqual([]);
  });

  it("prefers MMS when configured, verified, and media is present", async () => {
    const config = structuredClone(example.config) as CompanyConfig;
    config.communications.phoneNumber.verifiedCapabilities = { sms: true, mms: true, voice: true };
    config.communications.notifications.scheduleChange.channels = ["mms", "sms"];
    const fake = sender();
    const result = await sendConfiguredNotification({
      config,
      event: "scheduleChange",
      to: "+15005550100",
      body: "Updated schedule",
      consent: "opted_in",
      mediaUrls: ["https://example.com/schedule.pdf"],
      sender: fake
    });
    expect(result.channel).toBe("mms");
    expect(fake.sendMms).toHaveBeenCalledOnce();
    expect(fake.sendSms).not.toHaveBeenCalled();
  });

  it("requires opt-in and a verified channel", async () => {
    const config = structuredClone(example.config) as CompanyConfig;
    config.communications.phoneNumber.verifiedCapabilities = { sms: true, mms: false, voice: false };
    await expect(sendConfiguredNotification({
      config, event: "leaveDecision", to: "+15005550100", body: "Decision",
      consent: "unknown", sender: sender()
    })).rejects.toBeInstanceOf(NotificationError);

    const fake = sender();
    const result = await sendConfiguredNotification({
      config, event: "leaveDecision", to: "+15005550100", body: "Decision",
      consent: "opted_in", sender: fake
    });
    expect(result.channel).toBe("sms");
    expect(fake.sendSms).toHaveBeenCalledOnce();
  });
});
