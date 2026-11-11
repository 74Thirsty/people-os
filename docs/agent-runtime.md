# Provider-agnostic agent runtime

PeopleOS agent definitions remain tenant-owned and provider-independent. The runtime accepts a provider ID and model at execution time; provider credentials are supplied by server-side composition and are never stored in tenant JSON or passed to browser code.

## Included adapters

- `OpenAICompatibleProvider`: OpenAI-compatible chat-completions endpoints. It can be configured for compatible services such as OpenAI, Groq, OpenRouter, Ollama, LM Studio, or other compatible gateways. Compatibility and individual model capabilities must be verified against the selected endpoint.
- `AnthropicProvider`: native Anthropic Messages API.
- `GeminiProvider`: native Gemini generateContent API.

Adapters use the platform `fetch` API and add no SDK dependency. Each adapter normalizes provider output into the shared message/tool-call contract. Register only providers that are configured and approved for the deployment.

## Composition

Create one registry in server-only application composition, register enabled adapters, resolve the active tenant's agent context, then call `executeAgentTurn`. The caller must supply:
- a tenant-scoped system instruction assembled from the resolved agent, policies, and authorized context;
- the provider/model chosen by platform or tenant configuration;
- only tools exposed to that agent;
- an authorization callback backed by `authorizeAgentAction` and the authenticated tenant principal;
- an approval callback backed by the existing approval workflow.

The runtime deliberately does not look up credentials, infer a tenant, load employee records, or write payroll/timekeeping data itself. Those responsibilities belong to trusted server composition and domain services.

## Safety behavior

- Tool authorization runs immediately before every tool execution.
- Unknown tools and denied actions are not executed.
- Actions marked as approval-required execute only when the approval callback explicitly returns `approved`.
- Tool failures are returned to the model as failures; the runtime never claims the action succeeded.
- Tool-call count is bounded (default 8, hard maximum 20).
- No automatic provider failover occurs. Invalid credentials, permission failures, model errors, and unsafe tool failures must not be hidden by retrying another provider.
- Provider credentials remain in server-side environment/secret storage. Never put keys in tenant configuration, client bundles, logs, or prompts.

## Extending or removing providers

Implement `AgentProvider`, declare capabilities, and register it with `ProviderRegistry`. Remove a provider with `registry.remove(id)`; existing agent definitions do not need to change unless they explicitly select that provider. A provider's capabilities are explicit rather than assumed. Streaming is currently declared unsupported by the included adapters; it can be added behind the same contract without changing agents or tools.

## Current boundary

This change supplies the execution engine and provider adapters. It does not yet connect the runtime to Twilio inbound messages, create persistent conversation/session storage, or provide a tenant-facing provider management screen. Those require authenticated employee resolution, consent-aware routing, durable conversation schema, and secret-management decisions. No existing webhook behavior is silently changed by this foundational runtime.
