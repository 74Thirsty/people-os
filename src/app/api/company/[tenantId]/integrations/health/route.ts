import { createMicrosoftGraphClient } from "@/lib/integrations/microsoft-graph";
import { createTwilioClient, resolveTwilioConfig } from "@/lib/integrations/twilio";
import { evaluateReadiness } from "@/lib/company-config/readiness";
import { errorResponse, loadTenantPrincipal } from "@/lib/company-config/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function envValue(name: string | undefined, fallback: string): string | undefined {
  return process.env[name ?? fallback];
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await context.params;
    const principal = await loadTenantPrincipal(tenantId, "company.configuration.write");
    const config = principal.config;
    const store = principal.integrationStore;

    const microsoftTenantId = config.microsoft.connection.tenantId.value ??
      envValue(config.microsoft.connection.tenantId.envVar, "MICROSOFT_TENANT_ID");
    const microsoftClientId = config.microsoft.connection.clientId.value ??
      envValue(config.microsoft.connection.clientId.envVar, "MICROSOFT_CLIENT_ID");
    const microsoftSecretRef = config.microsoft.connection.clientSecret.reference.replace(/^env:/, "");
    const microsoftSecret = process.env[microsoftSecretRef] ?? envValue(microsoftSecretRef, "MICROSOFT_CLIENT_SECRET");

    let microsoftState: string;
    let microsoftEvidence: string | null;
    let microsoftCheckedAt: string | null = null;
    if (!microsoftTenantId || !microsoftClientId || !microsoftSecret) {
      microsoftState = "not_configured";
      microsoftEvidence = "Microsoft tenant ID, client ID, and client secret must be provisioned";
    } else {
      try {
        const client = createMicrosoftGraphClient({
          tenantId: microsoftTenantId,
          clientId: microsoftClientId,
          clientSecret: microsoftSecret
        });
        const mailbox = config.microsoft.mailboxes.shared[0]?.address.value ?? undefined;
        const health = await client.getConnectionHealth({ mailbox });
        microsoftState = health.status;
        microsoftEvidence = health.evidence;
        microsoftCheckedAt = health.lastCheckedAt;
      } catch (error) {
        microsoftState = "error";
        microsoftEvidence = error instanceof Error ? error.message.slice(0, 800) : "Microsoft probe failed";
        microsoftCheckedAt = new Date().toISOString();
      }
    }
    await store.upsert({
      tenantId,
      provider: "microsoft",
      state: microsoftState,
      credentialReferences: {
        tenantId: config.microsoft.connection.tenantId.envVar ?? "MICROSOFT_TENANT_ID",
        clientId: config.microsoft.connection.clientId.envVar ?? "MICROSOFT_CLIENT_ID",
        clientSecret: config.microsoft.connection.clientSecret.reference
      },
      phoneE164: null,
      capabilities: {},
      evidence: microsoftEvidence,
      lastCheckedAt: microsoftCheckedAt
    });

    const twilio = resolveTwilioConfig(config, process.env);
    let twilioState: string;
    let twilioEvidence: string | null;
    let twilioCheckedAt: string | null = null;
    let capabilities: Record<string, boolean> = { ...config.communications.phoneNumber.verifiedCapabilities };
    if (!twilio.configured || !twilio.credentials) {
      twilioState = "not_configured";
      twilioEvidence = `Missing telephony provisioning: ${twilio.missing.join(", ")}`;
    } else {
      try {
        const client = createTwilioClient(twilio.credentials);
        const health = await client.getConnectionHealth(twilio.credentials.fromNumber as string);
        twilioState = health.status;
        twilioEvidence = health.evidence;
        twilioCheckedAt = health.lastCheckedAt;
        capabilities = health.capabilities;
      } catch (error) {
        twilioState = "error";
        twilioEvidence = error instanceof Error ? error.message.slice(0, 800) : "Telephony probe failed";
        twilioCheckedAt = new Date().toISOString();
      }
    }
    await store.upsert({
      tenantId,
      provider: "twilio",
      state: twilioState,
      credentialReferences: {
        accountSid: config.communications.account.accountSid.envVar ?? "TWILIO_ACCOUNT_SID",
        authToken: config.communications.account.authToken.reference
      },
      phoneE164: config.communications.phoneNumber.e164.value ?? process.env.TWILIO_PHONE_NUMBER ?? null,
      capabilities,
      evidence: twilioEvidence,
      lastCheckedAt: twilioCheckedAt
    });

    const integrations = await store.loadStatuses(tenantId);
    const readiness = evaluateReadiness(config, { env: process.env, integrations });
    await principal.admin.from("audit_events").insert({
      tenant_id: tenantId,
      actor_user_id: principal.user.id,
      actor_type: "administrator",
      event_type: "integration.health.checked",
      subject_type: "integration",
      source_channel: "web",
      payload: { microsoft: microsoftState, communications: twilioState }
    });
    return Response.json({ readiness, integrations });
  } catch (error) {
    return errorResponse(error);
  }
}
