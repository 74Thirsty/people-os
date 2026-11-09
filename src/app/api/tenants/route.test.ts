import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, rpc } = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn()
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser },
    rpc
  }))
}));

import { POST } from "./route";

function makeRequest(body: string, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Request("http://localhost/api/tenants", {
    method: "POST",
    headers,
    body
  });
}

describe("POST /api/tenants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    rpc.mockResolvedValue({ data: "tenant-1", error: null });
  });

  it("rejects oversized streamed bodies before parsing or invoking the database", async () => {
    const body = JSON.stringify({
      legalName: "A".repeat(9000),
      displayName: "Company",
      timezone: "America/Chicago",
      requestKey: "b9e3f1e2-4c0a-4c2b-8d2f-1c9f2f5a8e11"
    });

    const response = await POST(makeRequest(body));

    expect(response.status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects non-JSON content types", async () => {
    const response = await POST(makeRequest("{}", { "content-type": "text/plain" }));
    expect(response.status).toBe(415);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("requires an authenticated user before reading tenant setup data", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await POST(makeRequest("{}"));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates a tenant through the authenticated-user RPC", async () => {
    const response = await POST(makeRequest(JSON.stringify({
      legalName: "Example Company",
      displayName: "Example",
      timezone: "America/Chicago",
      requestKey: "b9e3f1e2-4c0a-4c2b-8d2f-1c9f2f5a8e11"
    })));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ tenantId: "tenant-1" });
    expect(rpc).toHaveBeenCalledWith("create_tenant_for_current_user", expect.objectContaining({
      p_legal_name: "Example Company",
      p_display_name: "Example",
      p_timezone: "America/Chicago"
    }));
  });
});
