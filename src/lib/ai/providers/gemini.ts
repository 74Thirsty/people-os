import type { AgentProvider, ProviderRequest, ProviderResponse } from "../types";

export class GeminiProvider implements AgentProvider {
  readonly id = "gemini";
  readonly capabilities = { streaming: false, toolCalling: true, jsonMode: false, vision: true } as const;

  constructor(private readonly apiKey: string, private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta") {
    if (!apiKey) throw new Error("Gemini API key is required");
    if (!baseUrl.startsWith("https://")) throw new Error("Gemini baseUrl must use HTTPS");
  }

  async generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const contents = request.messages.map((message) => {
      if (message.role === "tool") return {
        role: "user", parts: [{ functionResponse: { name: message.toolName ?? "tool", response: { result: message.content } } }]
      };
      if (message.role === "assistant" && message.toolCalls?.length) return {
        role: "model", parts: message.toolCalls.map((call) => ({ functionCall: { name: call.name, args: call.arguments } }))
      };
      return { role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] };
    });
    const response = await fetch(`${this.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST", signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents,
        ...(request.tools?.length ? { tools: [{ functionDeclarations: request.tools.map((tool) => ({
          name: tool.name, description: tool.description, parameters: tool.parameters
        })) }] } : {}),
        generationConfig: {
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens })
        }
      })
    });
    if (!response.ok) throw new Error(`Provider gemini returned HTTP ${response.status}`);
    const payload = await response.json() as {
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((part) => part.text ?? "").join("");
    const toolCalls = parts.filter((part) => part.functionCall).map((part, index) => ({
      id: `gemini-${index}-${Date.now()}`, name: part.functionCall!.name, arguments: part.functionCall!.args ?? {}
    }));
    return {
      message: { role: "assistant", content: text, ...(toolCalls.length ? { toolCalls } : {}) },
      finishReason: toolCalls.length ? "tool_calls" : payload.candidates?.[0]?.finishReason === "STOP" ? "stop" : "unknown",
      usage: { inputTokens: payload.usageMetadata?.promptTokenCount, outputTokens: payload.usageMetadata?.candidatesTokenCount }
    };
  }
}
