import type { AdapterMap, AdapterRegistryLike, RegisteredWebhookAdapter } from "./types.js";

function normalizeProviderName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Provider name must be a non-empty string.");
  }
  return normalized;
}

export class AdapterRegistry implements AdapterRegistryLike {
  private readonly adapters = new Map<string, RegisteredWebhookAdapter>();

  constructor(initialAdapters: AdapterMap = {}) {
    for (const [name, adapter] of Object.entries(initialAdapters)) {
      this.register(name, adapter);
    }
  }

  register(name: string, adapter: RegisteredWebhookAdapter): void {
    this.adapters.set(normalizeProviderName(name), adapter);
  }

  get(name: string): RegisteredWebhookAdapter | undefined {
    return this.adapters.get(normalizeProviderName(name));
  }

  list(): string[] {
    return [...this.adapters.keys()].sort();
  }
}

export function createAdapterRegistry(initialAdapters: AdapterMap = {}): AdapterRegistry {
  return new AdapterRegistry(initialAdapters);
}
