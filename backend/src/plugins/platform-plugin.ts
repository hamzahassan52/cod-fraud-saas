import { NormalizedWebhookOrder } from '../types';

export interface PlatformPlugin {
  name: string;
  validateWebhook(headers: Record<string, string>, body: string, secret: string): boolean;
  normalizeOrder(rawPayload: unknown): NormalizedWebhookOrder;
}

export class PluginRegistry {
  private plugins: Map<string, PlatformPlugin> = new Map();

  register(plugin: PlatformPlugin): void {
    this.plugins.set(plugin.name, plugin);
  }

  get(name: string): PlatformPlugin | undefined {
    return this.plugins.get(name);
  }

  list(): string[] {
    return Array.from(this.plugins.keys());
  }
}

export const registry = new PluginRegistry();
