export type ProviderStatus = 'unchecked' | 'valid' | 'expired' | 'invalid';

/**
 * Base interface every provider client implements.
 * A single class per provider holds ALL its API query methods (validate,
 * listModels, chat/embeddings as needed) - one file per provider when flat.
 * When a file grows past ~150-200 lines (agent/notebook usage), split it into
 * providers/{name}/ micro-modules (see spec 007). Consumers import from index.ts.
 */
export interface ProviderClient {
  readonly provider: string;
  validate(key: string): Promise<ProviderStatus>;
}