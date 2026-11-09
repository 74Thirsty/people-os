import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TenantInput = z.object({
  legalName: z.string().trim().min(2).max(200),
  displayName: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(1).max(100),
  requestKey: z.string().uuid()
}).strict();

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let input: z.infer<typeof TenantInput>;
  try {
    input = TenantInput.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid tenant setup details" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("create_tenant_for_current_user", {
    p_legal_name: input.legalName,
    p_display_name: input.displayName,
    p_timezone: input.timezone,
    p_request_key: input.requestKey
  });
  if (error) {
    return NextResponse.json({ error: "Unable to create workspace: " + error.message }, { status: 400 });
  }
  return NextResponse.json({ tenantId: data }, { status: 201 });
}
