import { describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "./registry";
import { executeAgentTurn } from "./runtime";
import type { AgentProvider } from "./types";

function provider(generate: AgentProvider["generate"]): AgentProvider {
  return {
    id: "test-provider",
    capabilities: { streaming: false, toolCalling: true, jsonMode: false, vision: false },
    generate
  };
}

describe("ProviderRegistry", () => {
  it("registers, lists, resolves, and removes providers", () => {
    const registry = new ProviderRegistry();
    registry.register(provider(vi.fn()));
    expect(registry.list().map((item) => item.id)).toEqual(["test-provider"]);
    expect(registry.get("test-provider").id).toBe("test-provider");
    expect(registry.remove("test-provider")).toBe(true);
    expect(() => registry.get("test-provider")).toThrow("not registered");
  });

  it("rejects duplicate provider identifiers", () => {
    const registry = new ProviderRegistry();
    registry.register(provider(vi.fn()));
    expect(() => registry.register(provider(vi.fn()))).toThrow("already registered");
  });
});

describe("executeAgentTurn", () => {
  it("executes only authorized tools and returns the final provider response", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({
        message: { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "get_schedule", arguments: {} }] },
        finishReason: "tool_calls"
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: "Your schedule is ready." },
        finishReason: "stop"
      });
    const registry = new ProviderRegistry();
    registry.register(provider(generate));
    const execute = vi.fn().mockResolvedValue({ hours: 40 });
    const result = await executeAgentTurn(registry, {
      providerId: "test-provider", model: "test-model", system: "Tenant instructions",
      messages: [{ role: "user", content: "Show my schedule" }],
      tools: [{ definition: { name: "get_schedule", description: "Read schedule", parameters: { type: "object" } }, action: "schedule.read", execute }],
      authorizeTool: vi.fn().mockResolvedValue({ allowed: true, requiresApproval: false, reason: "Allowed" })
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(result.message.content).toBe("Your schedule is ready.");
    expect(result.toolExecutions[0].status).toBe("executed");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("never executes a denied action", async () => {
    const generate = vi.fn().mockResolvedValue({
      message: { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "release_payroll", arguments: {} }] },
      finishReason: "tool_calls"
    });
    const registry = new ProviderRegistry();
    registry.register(provider(generate));
    const execute = vi.fn();
    const result = await executeAgentTurn(registry, {
      providerId: "test-provider", model: "test-model", system: "Tenant instructions",
      messages: [{ role: "user", content: "Release payroll" }],
      tools: [{ definition: { name: "release_payroll", description: "Release payroll", parameters: { type: "object" } }, action: "payroll.release", execute }],
      authorizeTool: vi.fn().mockResolvedValue({ allowed: false, requiresApproval: false, reason: "Prohibited" })
    });
    expect(execute).not.toHaveBeenCalled();
    expect(result.toolExecutions[0].status).toBe("denied");
  });

  it("requires explicit approval before an approval-gated action", async () => {
    const generate = vi.fn().mockResolvedValue({
      message: { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "update_leave", arguments: {} }] },
      finishReason: "tool_calls"
    });
    const registry = new ProviderRegistry();
    registry.register(provider(generate));
    const execute = vi.fn();
    const result = await executeAgentTurn(registry, {
      providerId: "test-provider", model: "test-model", system: "Tenant instructions",
      messages: [{ role: "user", content: "Approve my leave" }],
      tools: [{ definition: { name: "update_leave", description: "Update leave", parameters: { type: "object" } }, action: "leave.approve", execute }],
      authorizeTool: vi.fn().mockResolvedValue({ allowed: true, requiresApproval: true, reason: "Manager approval required" }),
      onApprovalRequired: vi.fn().mockResolvedValue("rejected")
    });
    expect(execute).not.toHaveBeenCalled();
    expect(result.toolExecutions[0].status).toBe("approval_rejected");
  });
});
