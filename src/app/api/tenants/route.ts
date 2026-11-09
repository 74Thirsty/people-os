import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_REQUEST_BYTES = 8192;

const TenantInput = z.object({
  legalName: z.string().trim().min(2).max(200),
  displayName: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(1).max(100),
  requestKey: z.string().uuid()
}).strict();

class RequestBodyTooLargeError extends Error {}

async function readBoundedJsonBody(request: Request): Promise<string> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);

  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  if (contentLength !== null && Number.isFinite(contentLength) &&
      (contentLength < 0 || contentLength > MAX_REQUEST_BYTES)) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let input: z.infer<typeof TenantInput>;
  try {
    const body = await readBoundedJsonBody(request);
    input = TenantInput.parse(JSON.parse(body));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
    }
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
