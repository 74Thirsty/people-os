import type { AgentMessage, AgentRuntimeRequest, AgentRuntimeResult, RuntimeTool } from "./types";
import { ProviderRegistry } from "./registry";

function safeDetail(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 240) : "Tool execution failed";
}

/**
 * Executes a provider-independent agent turn. Tool authorization is evaluated
 * immediately before execution; provider output never grants permissions.
 */
export async function executeAgentTurn(
  registry: ProviderRegistry,
  request: AgentRuntimeRequest
): Promise<AgentRuntimeResult> {
  const provider = registry.get(request.providerId);
  if (request.tools?.length && !provider.capabilities.toolCalling) {
    throw new Error(`Provider ${provider.id} does not support tool calling`);
  }
  const toolMap = new Map<string, RuntimeTool>();
  for (const tool of request.tools ?? []) {
    if (toolMap.has(tool.definition.name)) throw new Error(`Duplicate tool: ${tool.definition.name}`);
    toolMap.set(tool.definition.name, tool);
  }

  const messages: AgentMessage[] = request.messages.map((message) => ({ ...message }));
  const toolExecutions: AgentRuntimeResult["toolExecutions"] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const maxToolCalls = Math.max(0, Math.min(request.maxToolCalls ?? 8, 20));
  let executedCalls = 0;

  for (let turn = 0; turn <= maxToolCalls; turn += 1) {
    const response = await provider.generate({
      model: request.model, system: request.system, messages,
      tools: [...toolMap.values()].map((tool) => tool.definition),
      temperature: request.temperature, maxOutputTokens: request.maxOutputTokens
    }, request.signal);
    usage.inputTokens += response.usage?.inputTokens ?? 0;
    usage.outputTokens += response.usage?.outputTokens ?? 0;
    messages.push(response.message);

    const calls = response.message.toolCalls ?? [];
    if (calls.length === 0) {
      return { message: response.message, messages, toolExecutions, usage };
    }
    if (turn === maxToolCalls || executedCalls + calls.length > maxToolCalls) {
      throw new Error("Agent exceeded the configured tool-call limit");
    }

    for (const call of calls) {
      executedCalls += 1;
      const tool = toolMap.get(call.name);
      if (!tool) {
        toolExecutions.push({ tool: call.name, status: "denied", detail: "Tool is not registered for this agent" });
        messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: "Denied: tool is not registered." });
        continue;
      }
      const decision = await request.authorizeTool(tool.action);
      if (!decision.allowed) {
        toolExecutions.push({ tool: call.name, status: "denied", detail: decision.reason });
        messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: `Denied: ${decision.reason}` });
        continue;
      }
      if (decision.requiresApproval) {
        const approval = await request.onApprovalRequired?.(call, decision.reason);
        if (approval !== "approved") {
          toolExecutions.push({ tool: call.name, status: "approval_rejected", detail: decision.reason });
          messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: "Not executed: required approval was not granted." });
          continue;
        }
      }
      try {
        const result = await tool.execute(call.arguments);
        toolExecutions.push({ tool: call.name, status: "executed", detail: "Completed" });
        messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: JSON.stringify(result ?? null) });
      } catch (error) {
        toolExecutions.push({ tool: call.name, status: "failed", detail: safeDetail(error) });
        messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: "Execution failed. Do not assume the action completed." });
      }
    }
  }
  throw new Error("Agent runtime reached an unexpected terminal state");
}
