import type { AgentProvider } from "./types";

/** Process-local registry. Register adapters at server startup; never store credentials here. */
export class ProviderRegistry {
  private readonly providers = new Map<string, AgentProvider>();

  register(provider: AgentProvider): void {
    const id = provider.id.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{1,48}$/.test(id)) throw new Error("Invalid provider id");
    if (this.providers.has(id)) throw new Error(`Provider already registered: ${id}`);
    this.providers.set(id, provider);
  }

  replace(provider: AgentProvider): void {
    const id = provider.id.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{1,48}$/.test(id)) throw new Error("Invalid provider id");
    this.providers.set(id, provider);
  }

  remove(id: string): boolean {
    return this.providers.delete(id.trim().toLowerCase());
  }

  get(id: string): AgentProvider {
    const provider = this.providers.get(id.trim().toLowerCase());
    if (!provider) throw new Error(`AI provider is not registered: ${id}`);
    return provider;
  }

  list(): Array<{ id: string; capabilities: AgentProvider["capabilities"] }> {
    return [...this.providers.values()].map(({ id, capabilities }) => ({ id, capabilities }));
  }
}
