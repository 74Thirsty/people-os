import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import TenantForm from "./tenant-form";

export default async function SetupPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <main className="auth-shell">
    <section className="auth-card">
      <Link className="brand" href="/"><span className="mark">P</span>PeopleOS</Link>
      <div className="eyebrow">Workspace setup</div>
      <h1>Create your company workspace.</h1>
      <p className="lead">Your account becomes the initial owner. You can invite authorized managers after setup.</p>
      <TenantForm />
    </section>
  </main>;
}
