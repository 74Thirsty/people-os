import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Tenant = { id: string; legal_name: string; display_name: string; timezone: string; status: string; };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_memberships").select("tenant_id, role").eq("user_id", user.id);
  if (membershipError) throw new Error("Unable to load tenant memberships: " + membershipError.message);
  if (!memberships?.length) redirect("/setup");

  const tenantIds = memberships.map((membership) => membership.tenant_id);
  const { data: tenants, error: tenantError } = await supabase
    .from("tenants").select("id, legal_name, display_name, timezone, status").in("id", tenantIds);
  if (tenantError) throw new Error("Unable to load tenant workspaces: " + tenantError.message);

  const workspaces = await Promise.all((tenants ?? []).map(async (tenant) => {
    const { count, error } = await supabase.from("employees")
      .select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id);
    if (error) throw new Error("Unable to load employee count: " + error.message);
    const membership = memberships.find((item) => item.tenant_id === tenant.id);
    return { ...(tenant as Tenant), role: membership?.role ?? "member", employeeCount: count ?? 0 };
  }));

  return <>
    <header className="topbar"><div className="shell topbar-inner">
      <Link className="brand" href="/"><span className="mark">P</span>PeopleOS</Link>
      <div className="account"><span>{user.email}</span><form action="/api/auth/signout" method="post"><button className="button-secondary" type="submit">Sign out</button></form></div>
    </div></header>
    <main className="shell">
      <div className="eyebrow">Employer command center</div>
      <h1>Your workforce.<br/>One operating system.</h1>
      <p className="lead">Live workspace data from Supabase. Counts reflect stored records—not estimates or generated sample data.</p>
      <div className="section-row"><h2 className="section">Company workspaces</h2><Link className="text-link" href="/setup">Create another workspace</Link></div>
      <section className="workspace-grid">
        {workspaces.map((tenant) => <article className="panel workspace" key={tenant.id}>
          <div className="workspace-head"><div><div className="eyebrow">{tenant.status}</div><h2>{tenant.display_name}</h2></div><span className="role">{tenant.role}</span></div>
          <div className="workspace-metrics">
            <div><span className="label">Employees</span><strong>{tenant.employeeCount}</strong></div>
            <div><span className="label">Time zone</span><strong className="timezone">{tenant.timezone}</strong></div>
          </div>
          <div className="workspace-foot"><span>{tenant.legal_name}</span><span>{tenant.id.slice(0, 8)}…</span></div>
        </article>)}
      </section>
      <h2 className="section">Connected platform services</h2>
      <section className="features">
        <article className="panel"><div className="eyebrow">Connected</div><h3>Supabase Auth</h3><p className="note">Email magic-link authentication with server-managed sessions.</p></article>
        <article className="panel"><div className="eyebrow">Connected</div><h3>PostgreSQL + RLS</h3><p className="note">Tenant memberships and employee reads are scoped by database policies.</p></article>
        <article className="panel"><div className="eyebrow">Configured by migration</div><h3>Private document storage</h3><p className="note">Tenant-folder storage policies are defined in the application migration.</p></article>
        <article className="panel"><div className="eyebrow">Server-only · gated</div><h3>Custodial HRS ledger</h3><p className="note">HRS posting remains unavailable to browser, employee, and agent credentials until trusted verifiers and custody infrastructure are wired.</p></article>
      </section>
      <div className="notice"><strong>Security boundary:</strong> Payroll, compensation changes, HRS minting, clock-event consumption, and employee lifecycle actions are not enabled by this dashboard. They require their dedicated authorization and audit workflows.</div>
    </main>
    <footer className="footer"><div className="shell">PeopleOS · Tenant-isolated workforce operations</div></footer>
  </>;
}
