import type { AgentProvider, ProviderRequest, ProviderResponse } from "../types";

export class AnthropicProvider implements AgentProvider {
  readonly id = "anthropic";
  readonly capabilities = { streaming: false, toolCalling: true, jsonMode: false, vision: true } as const;

  constructor(private readonly apiKey: string, private readonly version = "2023-06-01") {
    if (!apiKey) throw new Error("Anthropic API key is required");
  }

  async generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const messages = request.messages.map((message) => {
      if (message.role === "tool") return { role: "user", content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }] };
      if (message.role === "assistant" && message.toolCalls?.length) {
        return { role: "assistant", content: [
          ...(message.content ? [{ type: "text", text: message.content }] : []),
          ...message.toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.arguments }))
        ] };
      }
      return { role: message.role, content: message.content };
    });
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": this.version },
      body: JSON.stringify({
        model: request.model, system: request.system, messages,
        max_tokens: request.maxOutputTokens ?? 1024,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {})
      })
    });
    if (!response.ok) throw new Error(`Provider anthropic returned HTTP ${response.status}`);
    const payload = await response.json() as {
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (payload.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
    const toolCalls = (payload.content ?? []).filter((part) => part.type === "tool_use" && part.id && part.name)
      .map((part) => ({ id: part.id!, name: part.name!, arguments: part.input ?? {} }));
    return {
      message: { role: "assistant", content: text, ...(toolCalls.length ? { toolCalls } : {}) },
      finishReason: toolCalls.length ? "tool_calls" : payload.stop_reason === "end_turn" ? "stop" : payload.stop_reason === "max_tokens" ? "length" : "unknown",
      usage: { inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens }
    };
  }
}
