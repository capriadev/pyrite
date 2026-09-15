import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SettingsRepository } from '../../dal/settings/settings.repository';
import { CryptoService } from './crypto.service';
import { type SectionName } from './crypto-config';

/**
 * Sections whose records share one salt, kept in settings: one derivation serves
 * the whole section (spec 010). Everything else uses a salt per record.
 */
const SHARED_SALT_KEYS: Partial<Record<SectionName, string>> = {
  notes: 'notes.salt',
  notes_private: 'notes_private.salt',
};

interface CachedKey {
  passphrase: string;
  key: Buffer;
}

/**
 * One source of truth for section key derivation (spec 013). The cache is keyed by
 * section AND passphrase, so after a rotation nothing can encrypt with a key derived
 * from the previous passphrase - a stale entry is dropped on the first mismatch.
 * Pepper, KDF profile and salt decoding stay inside CryptoService.
 */
@Injectable()
export class SectionKeysService {
  private cache = new Map<SectionName, CachedKey>();

  constructor(
    private readonly crypto: CryptoService,
    private readonly settings: SettingsRepository,
  ) {}

  hasSharedSalt(section: SectionName): boolean {
    return SHARED_SALT_KEYS[section] !== undefined;
  }

  /** Cached derivation of a shared-salt section: the common path for reads and writes. */
  async sectionKey(passphrase: string, section: SectionName): Promise<Buffer> {
    const cached = this.cache.get(section);
    if (cached && cached.passphrase === passphrase) return cached.key;
    const key = await this.deriveSectionKey(passphrase, section);
    this.cache.set(section, { passphrase, key });
    return key;
  }

  /** Uncached derivation of a shared-salt section: staging must never seed the cache. */
  async deriveSectionKey(passphrase: string, section: SectionName): Promise<Buffer> {
    return this.crypto.deriveKey(passphrase, section, await this.sharedSalt(section));
  }

  /** Per-record salt: derived on demand, never cached (each record has its own salt). */
  recordKey(passphrase: string, section: SectionName, salt: string | Buffer): Promise<Buffer> {
    const value = typeof salt === 'string' ? Buffer.from(salt, 'base64') : salt;
    return this.crypto.deriveKey(passphrase, section, value);
  }

  /** Salt shared by every record of the section; created on first use. */
  async sharedSalt(section: SectionName): Promise<Buffer> {
    const key = SHARED_SALT_KEYS[section];
    if (!key) throw new Error(`section ${section} does not use a shared salt`);
    const row = await this.settings.findByKey(key);
    if (row) return Buffer.from(row.value as string, 'base64');
    const salt = randomBytes(16);
    await this.settings.upsert(key, salt.toString('base64'));
    return salt;
  }

  /** Drops the cached key of a section (lock or completed rotation). */
  evict(section: SectionName): void {
    this.cache.delete(section);
  }

  evictAll(): void {
    this.cache.clear();
  }
}