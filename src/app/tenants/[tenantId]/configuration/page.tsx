import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ConfigurationEditor from "./configuration-editor";

export const dynamic = "force-dynamic";

export default async function CompanyConfigurationPage({params}: {params: Promise<{tenantId:string}>}) {
  const {tenantId}=await params;
  const supabase=await createSupabaseServerClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) redirect("/login");
  const {data:membership}=await supabase.from("tenant_memberships")
    .select("role").eq("tenant_id",tenantId).eq("user_id",user.id).maybeSingle();
  if(!membership) notFound();
  const {data:tenant}=await supabase.from("tenants")
    .select("display_name").eq("id",tenantId).maybeSingle();
  const {data:configuration,error}=await supabase.from("tenant_configurations")
    .select("revision,configuration").eq("tenant_id",tenantId).maybeSingle();
  if(error || !configuration) notFound();
  const canEdit=membership.role==="owner" || membership.role==="administrator";
  return <main className="shell">
    <div className="section-row">
      <div><div className="eyebrow">Company settings</div><h1>{tenant?.display_name ?? "Company"} configuration</h1></div>
      <Link className="text-link" href="/">Back to workspaces</Link>
    </div>
    <p className="lead">One versioned JSON document defines this company&apos;s identity, contacts, people, permissions, policies, payroll settings, and agent configuration.</p>
    <ConfigurationEditor tenantId={tenantId} revision={configuration.revision}
      initialConfiguration={configuration.configuration} canEdit={canEdit}/>
  </main>;
}
