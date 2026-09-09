import { OpenAiClient } from './openai.client';
import { AnthropicClient } from './anthropic.client';
import { GitHubClient } from './github.client';
import { type ProviderClient } from './provider.types';

/**
 * Provider registry - single entry point. Consumers (APIs section, agent,
 * notebook) import ONLY from here by provider name, never from the client
 * files directly. Adding a provider = new folder + one line here.
 */
export const providerClients: Record<string, ProviderClient> = {
  openai: new OpenAiClient(),
  anthropic: new AnthropicClient(),
  github: new GitHubClient(),
};

export function getProviderClient(provider: string): ProviderClient | undefined {
  return providerClients[provider];
}

// Re-export the base interface so consumers can type against it.
export { type ProviderClient } from './provider.types';
export type { ProviderStatus } from './provider.types';