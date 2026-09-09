import { type ProviderClient, type ProviderStatus } from './provider.types';

/**
 * Anthropic provider client. validate() uses their x-api-key header.
 */
export class AnthropicClient implements ProviderClient {
  readonly provider = 'anthropic';

  async validate(key: string): Promise<ProviderStatus> {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key },
      });
      if (res.status === 401 || res.status === 403) return 'invalid';
      if (res.ok) return 'valid';
      return 'invalid';
    } catch {
      return 'invalid';
    }
  }
}