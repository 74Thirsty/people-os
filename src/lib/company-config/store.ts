import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyConfig } from "./schema";
import type {
  ActiveConfigStore,
  MembershipStore,
  StoredConfigVersion
} from "./service";
import type { StoredIntegrationStatus } from "./readiness";
import type {
  TenantIntegrationWrite,
  TenantOnboardingStore
} from "./onboarding";

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "unknown database error"}`);
}

export function createSupabaseActiveConfigStore(admin: SupabaseClient): ActiveConfigStore {
  return Object.freeze({
    async loadActiveConfigVersion(tenantId: string): Promise<StoredConfigVersion | null> {
      const { data, error } = await admin
        .from("tenant_config_versions")
        .select("tenant_id,version,content_hash,config,status,source,created_at,created_by")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .maybeSingle();
      if (error) fail("Unable to load active company configuration", error);
      if (!data) return null;
      const row = data as unknown as {
        tenant_id: string; version: string; content_hash: string; config: unknown;
        status: StoredConfigVersion["status"]; source: StoredConfigVersion["source"];
        created_at: string; created_by: string | null;
      };
      return {
        tenantId: row.tenant_id,
        version: row.version,
        hash: row.content_hash,
        config: row.config,
        status: row.status,
        source: row.source,
        createdAt: row.created_at,
        createdBy: row.created_by
      };
    }
  });
}

export function createSupabaseMembershipStore(client: SupabaseClient): MembershipStore {
  return Object.freeze({
    async loadMembership(tenantId: string, userId: string) {
      const { data, error } = await client
        .from("tenant_memberships")
        .select("role")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) fail("Unable to verify tenant membership", error);
      return data ? { role: (data as { role: string }).role } : null;
    }
  });
}

export interface IntegrationRecord {
  provider: "microsoft" | "twilio";
  state: StoredIntegrationStatus["state"];
  capabilities: Record<string, boolean>;
  evidence: string | null;
  lastCheckedAt: string | null;
  phoneE164: string | null;
}

export function createSupabaseIntegrationStore(admin: SupabaseClient) {
  return Object.freeze({
    async loadStatuses(tenantId: string): Promise<Partial<Record<"microsoft" | "communications", StoredIntegrationStatus>>> {
      const { data, error } = await admin
        .from("tenant_integrations")
        .select("provider,state,last_checked_at,evidence,capabilities")
        .eq("tenant_id", tenantId);
      if (error) fail("Unable to load integration status", error);
      const result: Partial<Record<"microsoft" | "communications", StoredIntegrationStatus>> = {};
      for (const row of (data ?? []) as Array<{
        provider: "microsoft" | "twilio"; state: StoredIntegrationStatus["state"];
        last_checked_at: string | null; evidence: string | null;
        capabilities: Record<string, boolean> | null;
      }>) {
        const mapped: StoredIntegrationStatus = {
          provider: row.provider,
          state: row.state,
          lastCheckedAt: row.last_checked_at,
          evidence: row.evidence,
          capabilities: row.capabilities ?? {}
        };
        if (row.provider === "microsoft") result.microsoft = mapped;
        if (row.provider === "twilio") result.communications = mapped;
      }
      return result;
    },

    async upsert(input: {
      tenantId: string;
      provider: "microsoft" | "twilio";
      state: string;
      credentialReferences: Record<string, string>;
      phoneE164: string | null;
      capabilities: Record<string, boolean>;
      evidence: string | null;
      lastCheckedAt: string | null;
    }) {
      const { error } = await admin.from("tenant_integrations").upsert({
        tenant_id: input.tenantId,
        provider: input.provider,
        state: input.state,
        credential_references: input.credentialReferences,
        phone_e164: input.phoneE164,
        capabilities: input.capabilities,
        evidence: input.evidence,
        last_checked_at: input.lastCheckedAt,
        updated_at: new Date().toISOString()
      }, { onConflict: "tenant_id,provider" });
      if (error) fail("Unable to store integration status", error);
    },

    async resolveTenantByPhone(phoneE164: string): Promise<string | null> {
      const { data, error } = await admin
        .from("tenant_integrations")
        .select("tenant_id")
        .eq("provider", "twilio")
        .eq("phone_e164", phoneE164)
        .maybeSingle();
      if (error) fail("Unable to resolve messaging tenant", error);
      return data ? (data as { tenant_id: string }).tenant_id : null;
    },

    async getConsent(tenantId: string, phoneE164: string): Promise<"unknown" | "opted_in" | "opted_out"> {
      const { data, error } = await admin
        .from("tenant_messaging_contacts")
        .select("consent_state")
        .eq("tenant_id", tenantId)
        .eq("phone_e164", phoneE164)
        .maybeSingle();
      if (error) fail("Unable to load messaging consent", error);
      return data ? (data as { consent_state: "unknown" | "opted_in" | "opted_out" }).consent_state : "unknown";
    },

    async setConsent(input: {
      tenantId: string;
      phoneE164: string;
      state: "opted_in" | "opted_out";
      source: string;
    }) {
      const { error } = await admin.from("tenant_messaging_contacts").upsert({
        tenant_id: input.tenantId,
        phone_e164: input.phoneE164,
        consent_state: input.state,
        consent_source: input.source,
        consent_updated_at: new Date().toISOString()
      }, { onConflict: "tenant_id,phone_e164" });
      if (error) fail("Unable to record messaging consent", error);
    },

    async recordInboundMessage(input: {
      tenantId: string;
      providerSid: string;
      channel: "sms" | "mms";
      fromE164: string;
      toE164: string;
      body: string;
      mediaUrls: string[];
    }) {
      const { error } = await admin.from("tenant_messages").upsert({
        tenant_id: input.tenantId,
        provider_sid: input.providerSid,
        direction: "inbound",
        channel: input.channel,
        from_e164: input.fromE164,
        to_e164: input.toE164,
        body: input.body,
        media_urls: input.mediaUrls,
        status: "received",
        metadata: {}
      }, { onConflict: "tenant_id,provider_sid", ignoreDuplicates: true });
      if (error) fail("Unable to record inbound message", error);
    },

    async updateMessageStatus(input: {
      tenantId: string;
      providerSid: string;
      status: string;
      errorCode: string | null;
    }) {
      const { error } = await admin
        .from("tenant_messages")
        .update({ status: input.status, error_code: input.errorCode, updated_at: new Date().toISOString() })
        .eq("tenant_id", input.tenantId)
        .eq("provider_sid", input.providerSid);
      if (error) fail("Unable to update message delivery status", error);
    }
  });
}

export function createSupabaseOnboardingStore(admin: SupabaseClient): TenantOnboardingStore {
  return Object.freeze({
    async findTenantBySlug(slug: string) {
      const { data, error } = await admin
        .from("tenants")
        .select("id,status")
        .eq("config_slug", slug)
        .maybeSingle();
      if (error) fail("Unable to find tenant by configuration slug", error);
      if (!data) return null;
      const row = data as { id: string; status: string };
      return { id: row.id, status: row.status };
    },

    async createTenant(input: {
      configSlug: string;
      legalName: string;
      displayName: string;
      timezone: string;
      status: "provisioning" | "active";
    }) {
      const { data, error } = await admin.from("tenants").insert({
        legal_name: input.legalName,
        display_name: input.displayName,
        timezone: input.timezone,
        status: input.status,
        config_slug: input.configSlug
      }).select("id,status").single();
      if (error) {
        const existing = await this.findTenantBySlug(input.configSlug);
        if (existing) return existing;
        fail("Unable to create tenant from configuration", error);
      }
      const row = data as unknown as { id: string; status: string };
      return { id: row.id, status: row.status };
    },

    async ensureMembership(tenantId: string, userId: string, role: "owner") {
      const { error } = await admin.from("tenant_memberships").upsert(
        { tenant_id: tenantId, user_id: userId, role },
        { onConflict: "tenant_id,user_id", ignoreDuplicates: true }
      );
      if (error) fail("Unable to assign tenant ownership", error);
    },

    async loadActiveVersionSummary(tenantId: string) {
      const { data, error } = await admin
        .from("tenant_config_versions")
        .select("version,content_hash")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .maybeSingle();
      if (error) fail("Unable to load active configuration version", error);
      if (!data) return null;
      const row = data as { version: string; content_hash: string };
      return { version: row.version, hash: row.content_hash };
    },

    async publishConfigVersion(input: {
      tenantId: string;
      version: string;
      hash: string;
      config: CompanyConfig;
      source: "repository" | "admin";
      createdBy: string | null;
      changeSummary: string;
    }) {
      const { error } = await admin.rpc("publish_tenant_config_version", {
        p_tenant_id: input.tenantId,
        p_version: input.version,
        p_content_hash: input.hash,
        p_config: input.config,
        p_source: input.source,
        p_created_by: input.createdBy,
        p_change_summary: input.changeSummary
      });
      if (error) fail("Unable to publish tenant configuration", error);
    },

    async upsertIntegration(tenantId: string, integration: TenantIntegrationWrite) {
      const { error } = await admin.from("tenant_integrations").upsert({
        tenant_id: tenantId,
        provider: integration.provider,
        state: integration.state,
        credential_references: integration.credentialReferences,
        phone_e164: integration.phoneE164,
        capabilities: integration.capabilities,
        evidence: integration.evidence,
        last_checked_at: integration.lastCheckedAt,
        updated_at: new Date().toISOString()
      }, { onConflict: "tenant_id,provider" });
      if (error) fail("Unable to store tenant integration", error);
    },

    async updateTenantStatus(tenantId: string, status: "active" | "suspended" | "provisioning") {
      const { error } = await admin.from("tenants").update({ status, updated_at: new Date().toISOString() }).eq("id", tenantId);
      if (error) fail("Unable to change tenant status", error);
    },

    async recordAudit(input: {
      tenantId: string;
      actorUserId: string | null;
      eventType: string;
      payload: Record<string, unknown>;
    }) {
      const { error } = await admin.from("audit_events").insert({
        tenant_id: input.tenantId,
        actor_user_id: input.actorUserId,
        actor_type: input.actorUserId ? "administrator" : "system",
        event_type: input.eventType,
        subject_type: "tenant",
        subject_id: input.tenantId,
        source_channel: "system",
        payload: input.payload
      });
      if (error) fail("Unable to record tenant audit event", error);
    }
  });
}
