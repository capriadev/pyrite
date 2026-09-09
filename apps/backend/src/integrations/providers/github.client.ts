import { type ProviderClient, type ProviderStatus } from './provider.types';

/**
 * GitHub provider client. validate() via GET /user with Bearer token.
 */
export class GitHubClient implements ProviderClient {
  readonly provider = 'github';

  async validate(key: string): Promise<ProviderStatus> {
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.status === 401 || res.status === 403) return 'invalid';
      if (res.ok) return 'valid';
      return 'invalid';
    } catch {
      return 'invalid';
    }
  }
}