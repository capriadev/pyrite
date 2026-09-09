import { type ProviderClient, type ProviderStatus } from './provider.types';

/**
 * OpenAI provider client. All OpenAI API query methods in one place.
 * Today: validate + listModels. Growth: chat/embeddings when the agent needs
 * them - add as methods here, split into providers/openai/ when it grows past
 * ~150-200 lines.
 */
export class OpenAiClient implements ProviderClient {
  readonly provider = 'openai';

  async validate(key: string): Promise<ProviderStatus> {
    return this.bearerStatus('https://api.openai.com/v1/models', key);
  }

  async listModels(key: string): Promise<unknown> {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`openai models: ${res.status}`);
    return res.json();
  }

  private async bearerStatus(url: string, key: string): Promise<ProviderStatus> {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      if (res.status === 401 || res.status === 403) return 'invalid';
      if (res.ok) return 'valid';
      return 'invalid';
    } catch {
      return 'invalid';
    }
  }
}