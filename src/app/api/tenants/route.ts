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
  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  if (Number.isFinite(contentLength) && contentLength > 8192) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let input: z.infer<typeof TenantInput>;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 8192) {
      return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
    }
    input = TenantInput.parse(JSON.parse(body));
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
    return NextResponse.json({ error: "Unable to create workspace. Verify the details and try again." }, { status: 500 });
  }
  return NextResponse.json({ tenantId: data }, { status: 201 });
}
