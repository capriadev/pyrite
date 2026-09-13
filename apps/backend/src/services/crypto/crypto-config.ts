import 'dotenv/config';

/**
 * Crypto strength profiles, read from environment.
 * One module, parametrized per domain - no parallel implementations.
 */
export interface CryptoProfile {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  sharedSalt: boolean;
}

export type SectionName = 'notes' | 'notes_private' | 'apis' | 'vault' | 'counts';

export const SECTION_CRYPTO_CONFIG: Record<SectionName, { profile: CryptoProfile; pepper: string }> = {
  notes: {
    profile: {
      memoryCost: Number(process.env.CRYPTO_PROFILE_LIGHT_MEMORY ?? 19456),
      timeCost: Number(process.env.CRYPTO_PROFILE_LIGHT_TIME ?? 2),
      parallelism: Number(process.env.CRYPTO_PROFILE_LIGHT_PARALLELISM ?? 1),
      sharedSalt: process.env.CRYPTO_PROFILE_LIGHT_SHARED_SALT !== 'false',
    },
    pepper: process.env.CRYPTO_NOTES_PEPPER ?? '',
  },
  notes_private: {
    profile: {
      memoryCost: Number(process.env.CRYPTO_PROFILE_MEDIUM_MEMORY ?? 65536),
      timeCost: Number(process.env.CRYPTO_PROFILE_MEDIUM_TIME ?? 3),
      parallelism: Number(process.env.CRYPTO_PROFILE_MEDIUM_PARALLELISM ?? 2),
      sharedSalt: process.env.CRYPTO_PROFILE_MEDIUM_SHARED_SALT !== 'false',
    },
    pepper: process.env.CRYPTO_NOTES_PRIVATE_PEPPER ?? '',
  },
  apis: {
    profile: {
      memoryCost: Number(process.env.CRYPTO_PROFILE_MEDIUM_MEMORY ?? 65536),
      timeCost: Number(process.env.CRYPTO_PROFILE_MEDIUM_TIME ?? 3),
      parallelism: Number(process.env.CRYPTO_PROFILE_MEDIUM_PARALLELISM ?? 2),
      sharedSalt: process.env.CRYPTO_PROFILE_MEDIUM_SHARED_SALT !== 'false',
    },
    pepper: process.env.CRYPTO_APIS_PEPPER ?? '',
  },
  vault: {
    profile: {
      memoryCost: Number(process.env.CRYPTO_PROFILE_MEDIUM_MEMORY ?? 65536),
      timeCost: Number(process.env.CRYPTO_PROFILE_MEDIUM_TIME ?? 3),
      parallelism: Number(process.env.CRYPTO_PROFILE_MEDIUM_PARALLELISM ?? 2),
      sharedSalt: process.env.CRYPTO_PROFILE_MEDIUM_SHARED_SALT !== 'false',
    },
    pepper: process.env.CRYPTO_VAULT_PEPPER ?? '',
  },
  counts: {
    profile: {
      memoryCost: Number(process.env.CRYPTO_PROFILE_HEAVY_MEMORY ?? 131072),
      timeCost: Number(process.env.CRYPTO_PROFILE_HEAVY_TIME ?? 4),
      parallelism: Number(process.env.CRYPTO_PROFILE_HEAVY_PARALLELISM ?? 2),
      sharedSalt: process.env.CRYPTO_PROFILE_HEAVY_SHARED_SALT === 'true',
    },
    pepper: process.env.CRYPTO_COUNTS_PEPPER ?? '',
  },
};

export const LOGIN_PEPPER = process.env.PASSWORD_PEPPER ?? '';
export const LOGIN_PROFILE: CryptoProfile = {
  memoryCost: Number(process.env.CRYPTO_PROFILE_MEDIUM_MEMORY ?? 65536),
  timeCost: Number(process.env.CRYPTO_PROFILE_MEDIUM_TIME ?? 3),
  parallelism: Number(process.env.CRYPTO_PROFILE_MEDIUM_PARALLELISM ?? 2),
  sharedSalt: true,
};