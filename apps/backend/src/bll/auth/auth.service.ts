import { Injectable, OnModuleInit } from '@nestjs/common';
import { CryptoService, type CanaryData } from '../../services/crypto/crypto.service';
import { SettingsRepository } from '../../dal/settings/settings.repository';
import { type SectionName } from '../../services/crypto/crypto-config';

const SECTIONS: SectionName[] = ['notes', 'notes_private', 'apis', 'vault', 'counts'];

/**
 * AuthService manages unlock state per section and the login barrier.
 * Key derivation is per-record (salt per record), so the passphrase
 * (not the derived key) is stored in memory while a section is unlocked.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  /** Stored passphrase per section (cleartext in memory while unlocked). */
  private passphrases = new Map<SectionName | 'login', string>();
  private unlockedAt = new Map<SectionName | 'login', number>();
  private ttlMs = 5 * 60 * 1000;
constructor(
    private readonly crypto: CryptoService,
    private readonly settings: SettingsRepository,
  ) {}
  onModuleInit(): void {
    setInterval(() => this.purgeExpired(), 30_000);
  }

  // ============ LOGIN (hash-mode) ============

  async isLoginSet(): Promise<boolean> {
    const row = await this.settings.findByKey('auth.password_hash');
    return !!row;
  }

  async login(password: string): Promise<boolean> {
    const row = await this.settings.findByKey('auth.password_hash');
    if (!row) return false;
    const valid = await this.crypto.verifyPassword(password, row.value as string);
    if (valid) {
      this.passphrases.set('login', '');
      this.unlockedAt.set('login', Date.now());
    }
    return valid;
  }

  async setLoginPassword(password: string): Promise<void> {
    const { hash } = await this.crypto.hashPassword(password);
    await this.settings.upsert('auth.password_hash', hash);
  }

  isLoginUnlocked(): boolean {
    return this.passphrases.has('login');
  }

  // ============ SECTION UNLOCK (KDF + canary) ============

  async isSectionSet(section: SectionName): Promise<boolean> {
    const row = await this.settings.findByKey(`${section}.canary`);
    return !!row;
  }

  async unlockSection(section: SectionName, passphrase: string): Promise<boolean> {
    const canaryRow = await this.settings.findByKey(`${section}.canary`);
    if (!canaryRow) return false;
    const canary = canaryRow.value as unknown as CanaryData;
    const valid = await this.crypto.verifyCanary(passphrase, section, canary);
    if (valid) {
      this.passphrases.set(section, passphrase);
      this.unlockedAt.set(section, Date.now());
    }
    return valid;
  }

  lockSection(section: SectionName): void {
    this.passphrases.delete(section);
    this.unlockedAt.delete(section);
  }

  isSectionUnlocked(section: SectionName): boolean {
    if (!this.passphrases.has(section)) return false;
    if (this.isExpired(section)) {
      this.passphrases.delete(section);
      this.unlockedAt.delete(section);
      return false;
    }
    return true;
  }

  getSectionPassphrase(section: SectionName): string | undefined {
    if (!this.isSectionUnlocked(section)) return undefined;
    return this.passphrases.get(section);
  }

  async setSectionPassphrase(section: SectionName, passphrase: string): Promise<void> {
    const canary = await this.crypto.createCanary(passphrase, section);
    await this.settings.upsert(`${section}.canary`, canary as unknown as Record<string, unknown>);
  }

  status(): Record<string, boolean> {
    const result: Record<string, boolean> = { login: this.isLoginUnlocked() };
    for (const s of SECTIONS) {
      result[s] = this.isSectionUnlocked(s);
    }
    return result;
  }

  validSection(section: string): boolean {
    return SECTIONS.includes(section as SectionName);
  }

  lockAll(): void {
    this.passphrases.clear();
    this.unlockedAt.clear();
  }

  // ============ PRIVATE ============

  private isExpired(section: SectionName | 'login'): boolean {
    const at = this.unlockedAt.get(section);
    if (at === undefined) return true;
    if (section === 'login') return false;
    return Date.now() - at > this.ttlMs;
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, at] of this.unlockedAt) {
      if (key !== 'login' && now - at > this.ttlMs) {
        this.passphrases.delete(key);
        this.unlockedAt.delete(key);
      }
    }
  }
}