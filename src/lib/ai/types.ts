export type AgentRole = "user" | "assistant" | "tool";

export interface AgentMessage {
  role: AgentRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: AgentToolCall[];
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  jsonMode: boolean;
  vision: boolean;
}

export interface ProviderRequest {
  model: string;
  system: string;
  messages: AgentMessage[];
  tools?: AgentToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ProviderResponse {
  message: AgentMessage;
  finishReason: "stop" | "tool_calls" | "length" | "unknown";
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AgentProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse>;
}

export interface RuntimeTool {
  definition: AgentToolDefinition;
  action: string;
  execute(input: Record<string, unknown>): Promise<unknown>;
}

export interface AgentRuntimeRequest {
  providerId: string;
  model: string;
  system: string;
  messages: AgentMessage[];
  tools?: RuntimeTool[];
  authorizeTool: (action: string) => Promise<{ allowed: boolean; requiresApproval: boolean; reason: string }>;
  onApprovalRequired?: (tool: AgentToolCall, reason: string) => Promise<"approved" | "rejected">;
  maxToolCalls?: number;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface AgentRuntimeResult {
  message: AgentMessage;
  messages: AgentMessage[];
  toolExecutions: Array<{ tool: string; status: "executed" | "denied" | "approval_rejected" | "failed"; detail: string }>;
  usage: { inputTokens: number; outputTokens: number };
}
