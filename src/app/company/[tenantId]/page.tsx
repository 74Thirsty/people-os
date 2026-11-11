import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createSupabaseActiveConfigStore,
  createSupabaseMembershipStore
} from "@/lib/company-config/store";
import { createCompanyConfigService } from "@/lib/company-config/service";
import { evaluateReadiness, type StoredIntegrationStatus } from "@/lib/company-config/readiness";
import { resolvePayPeriod } from "@/lib/company-config/timekeeping";
import { roleHasPermission } from "@/lib/company-config/access";
import ConfigEditor from "./config-editor";

export const dynamic = "force-dynamic";

type IntegrationRow = {
  provider: "microsoft" | "twilio";
  state: StoredIntegrationStatus["state"];
  last_checked_at: string | null;
  evidence: string | null;
  capabilities: Record<string, boolean> | null;
  phone_e164: string | null;
};

export default async function CompanyConfigPage({
  params
}: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("tenant_memberships").select("role")
    .eq("tenant_id", tenantId).eq("user_id", user.id).maybeSingle();
  if (!membership) notFound();

  const { data: tenant } = await supabase
    .from("tenants").select("id,legal_name,display_name,timezone,status,config_slug")
    .eq("id", tenantId).maybeSingle();
  if (!tenant) notFound();

  let resolved;
  try {
    resolved = await createCompanyConfigService(
      createSupabaseActiveConfigStore(supabase),
      createSupabaseMembershipStore(supabase)
    ).resolveForMembership(tenantId, user.id);
  } catch (error) {
    return <main className="shell">
      <div className="eyebrow">Company configuration</div>
      <h1>{tenant.display_name}</h1>
      <div className="notice">
        <strong>Configuration unavailable.</strong>{" "}
        {error instanceof Error ? error.message : "No active configuration could be loaded."}
      </div>
      <p className="lead">Provision this tenant from a validated repository configuration before using company workflows.</p>
      <Link className="text-link" href="/">← Back to workspaces</Link>
    </main>;
  }

  if (!resolved.role || !roleHasPermission(resolved.role, "company.configuration.read")) notFound();
  const config = resolved.config;
  const { data: integrationRows } = await supabase
    .from("tenant_integrations")
    .select("provider,state,last_checked_at,evidence,capabilities,phone_e164")
    .eq("tenant_id", tenantId);
  const integrations: Partial<Record<"microsoft" | "communications", StoredIntegrationStatus>> = {};
  for (const row of (integrationRows ?? []) as IntegrationRow[]) {
    const status: StoredIntegrationStatus = {
      provider: row.provider,
      state: row.state,
      lastCheckedAt: row.last_checked_at,
      evidence: row.evidence,
      capabilities: row.capabilities ?? {}
    };
    if (row.provider === "microsoft") integrations.microsoft = status;
    if (row.provider === "twilio") integrations.communications = status;
  }
  const readiness = evaluateReadiness(config, { env: process.env, integrations });
  const today = new Date().toISOString().slice(0, 10);
  const payPeriod = resolvePayPeriod(config, today);
  const canEdit = Boolean(resolved.role && roleHasPermission(resolved.role, "company.configuration.write"));
  const canManageStatus = Boolean(resolved.role && roleHasPermission(resolved.role, "tenant.status.manage"));

  return <>
    <header className="topbar"><div className="shell topbar-inner">
      <Link className="brand" href="/"><span className="mark">P</span>PeopleOS</Link>
      <div className="account"><span>{user.email}</span>
        <form action="/api/auth/signout" method="post"><button className="button-secondary" type="submit">Sign out</button></form>
      </div>
    </div></header>
    <main className="shell">
      <Link className="text-link" href="/">← All workspaces</Link>
      <div className="eyebrow" style={{ marginTop: 28 }}>Company configuration</div>
      <h1>{config.identity.operatingName}</h1>
      <p className="lead">
        {config.identity.legalName} · Configuration v{resolved.version} · Tenant {tenant.status}
        {tenant.config_slug ? ` · ${tenant.config_slug}` : ""}
      </p>

      {!readiness.canActivate && <div className="notice">
        <strong>Activation requirements outstanding.</strong> This tenant is configured but not operational for live communications or payroll until these items are resolved:
        <ul>{readiness.activationBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
      </div>}

      <div className="workspace-grid" style={{ marginTop: 24 }}>
        <section className="panel">
          <div className="eyebrow">Integration readiness</div>
          <h2 style={{ margin: "8px 0 16px" }}>Microsoft and telephony</h2>
          <div style={{ display: "grid", gap: 12 }}>
            <div><span className="label">Microsoft 365 / Entra / Graph</span><strong style={{ display: "block" }}>{readiness.microsoft.state}</strong><small>{readiness.microsoft.evidence ?? (readiness.microsoft.missing.join(", ") || "No live verification yet.")}</small></div>
            <div><span className="label">SMS / MMS / voice ({config.communications.provider})</span><strong style={{ display: "block" }}>{readiness.communications.state}</strong><small>{readiness.communications.evidence ?? (readiness.communications.missing.join(", ") || "No verified number.")}</small></div>
            <div><span className="label">Enforceable HR policies</span><strong style={{ display: "block" }}>{readiness.policies.enforceable.length} of {config.hr.policies.length}</strong><small>{readiness.policies.requiringConfirmation.length} require company confirmation.</small></div>
          </div>
        </section>

        <section className="panel">
          <div className="eyebrow">Operating context</div>
          <h2 style={{ margin: "8px 0 16px" }}>Configured workforce rules</h2>
          <div className="workspace-metrics">
            <div><span className="label">Time zone</span><strong className="timezone">{config.identity.timezone}</strong></div>
            <div><span className="label">Pay period</span><strong>{payPeriod.start} → {payPeriod.end}</strong></div>
            <div><span className="label">Workweek starts</span><strong>{config.hr.timekeeping.workweek.startDay}</strong></div>
            <div><span className="label">Overtime after</span><strong>{config.hr.timekeeping.overtime.weeklyThresholdMinutes / 60} h</strong></div>
            <div><span className="label">Currency</span><strong>{config.payroll.currency.value ?? "unconfirmed"}</strong></div>
            <div><span className="label">Live payroll</span><strong>{config.payroll.provider.status}</strong></div>
          </div>
          <p className="note" style={{ marginTop: 16 }}>
            Pay period {payPeriod.key}; cutoff {payPeriod.cutoffDate}. HRS schedules are time accounting only and are never treated as earned wages.
          </p>
        </section>
      </div>

      <h2 className="section">Business identity and policy controls</h2>
      <ConfigEditor
        tenantId={tenantId}
        canEdit={canEdit}
        canManageStatus={canManageStatus}
        config={{
          operatingName: config.identity.operatingName,
          description: config.identity.description,
          website: config.identity.website.value,
          contactEmail: config.identity.contact.email.value,
          contactTelephone: config.identity.contact.telephone.value
        }}
        policies={config.hr.policies.map((policy) => ({
          id: policy.id,
          name: policy.name,
          status: policy.status,
          sourceStatus: policy.source.status
        }))}
      />

      <div className="workspace-grid" style={{ marginTop: 24 }}>
        <section className="panel">
          <div className="eyebrow">Agents resolved from this configuration</div>
          <h2 style={{ margin: "8px 0 16px" }}>Company-specific agent scope</h2>
          {config.agents.definitions.map((agent) => <div key={agent.id} style={{ marginBottom: 16 }}>
            <strong>{agent.name} {agent.enabled ? "" : "(disabled)"}</strong>
            <p className="note" style={{ margin: "4px 0" }}>{agent.purpose}</p>
            <small>Channels: {agent.channels.join(", ")} · Policies: {agent.policyAccess.length} · Approvals: {agent.approvalRequiredFor.join(", ") || "none"}</small>
          </div>)}
        </section>

        <section className="panel">
          <div className="eyebrow">Workforce roles and permissions</div>
          <h2 style={{ margin: "8px 0 16px" }}>Approval authority</h2>
          {config.workforce.roles.map((role) => <div key={role.id} style={{ marginBottom: 12 }}>
            <strong>{role.name}</strong>
            <div><small>{role.permissions.includes("*") ? "All tenant permissions" : `${role.permissions.length} permissions`} · employee records: {role.dataAccess.employeeRecords} · compensation: {role.dataAccess.compensation}</small></div>
          </div>)}
        </section>
      </div>

      <h2 className="section">Integration status detail</h2>
      <section className="panel">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ textAlign: "left", color: "var(--muted)" }}><th>Provider</th><th>State</th><th>Number</th><th>Last check</th><th>Evidence</th></tr></thead>
          <tbody>
            {(integrationRows ?? []).map((row) => <tr key={row.provider} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={{ padding: "10px 6px" }}>{row.provider}</td>
              <td>{row.state}</td>
              <td>{row.phone_e164 ?? "—"}</td>
              <td>{row.last_checked_at ? new Date(row.last_checked_at).toLocaleString() : "Never"}</td>
              <td>{row.evidence ?? "Not verified"}</td>
            </tr>)}
          </tbody>
        </table>
        <p className="note" style={{ marginTop: 14 }}>
          Configured values are references only. Secrets remain in the server environment or managed secret store, never in configuration or Git.
        </p>
      </section>
    </main>
    <footer className="footer"><div className="shell">PeopleOS · Configuration-driven workforce operations</div></footer>
  </>;
}
