import type { AgentMessage, AgentProvider, ProviderRequest, ProviderResponse } from "../types";

export interface OpenAICompatibleOptions {
  id: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  capabilities?: Partial<AgentProvider["capabilities"]>;
}

function normalizeMessage(message: AgentMessage) {
  if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id, type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) }
      }))
    };
  }
  return { role: message.role, content: message.content };
}

export class OpenAICompatibleProvider implements AgentProvider {
  readonly id: string;
  readonly capabilities: AgentProvider["capabilities"];
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly headers: Record<string, string>;

  constructor(options: OpenAICompatibleOptions) {
    this.id = options.id;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.headers = options.headers ?? {};
    this.capabilities = {
      streaming: false, toolCalling: true, jsonMode: false, vision: false,
      ...options.capabilities
    };
    if (!/^https:\/\//.test(this.baseUrl) && !/^http:\/\/localhost(?::\d+)?/.test(this.baseUrl) && !/^http:\/\/127\.0\.0\.1(?::\d+)?/.test(this.baseUrl)) {
      throw new Error("Provider baseUrl must use HTTPS (HTTP is allowed only for localhost)");
    }
  }

  async generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        ...this.headers
      },
      body: JSON.stringify({
        model: request.model,
        messages: [{ role: "system", content: request.system }, ...request.messages.map(normalizeMessage)],
        ...(request.tools?.length ? { tools: request.tools.map((tool) => ({
          type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters }
        })) } : {}),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens })
      })
    });
    if (!response.ok) throw new Error(`Provider ${this.id} returned HTTP ${response.status}`);
    const payload = await response.json() as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = payload.choices?.[0];
    if (!choice?.message) throw new Error(`Provider ${this.id} returned an empty completion`);
    const toolCalls = (choice.message.tool_calls ?? []).map((call) => {
      let args: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(call.function.arguments || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Tool arguments must be an object");
        args = parsed as Record<string, unknown>;
      } catch {
        throw new Error(`Provider ${this.id} returned invalid arguments for tool ${call.function.name}`);
      }
      return { id: call.id, name: call.function.name, arguments: args };
    });
    return {
      message: { role: "assistant", content: choice.message.content ?? "", ...(toolCalls.length ? { toolCalls } : {}) },
      finishReason: toolCalls.length ? "tool_calls" : choice.finish_reason === "length" ? "length" : choice.finish_reason === "stop" ? "stop" : "unknown",
      usage: { inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens }
    };
  }
}
