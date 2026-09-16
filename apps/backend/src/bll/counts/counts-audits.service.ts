import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { CountsRepository, type CountsAccountRow } from '../../dal/counts/counts.repository';
import { CryptoService } from '../../services/crypto/crypto.service';
import { SectionKeysService } from '../../services/crypto/section-keys';
import { AuthService } from '../auth/auth.service';
import { SettingsService } from '../settings/settings.service';
import { fieldCipher, secretAad } from './counts-fields';
import { toViews, type CountsAccountView } from './counts-view';

const SECTION = 'counts';
const WEAK_THRESHOLD_KEY = 'counts.weak_threshold';
/** Fallback used until the threshold is set from the settings UI. */
const DEFAULT_WEAK_THRESHOLD = 50;

export interface CountsDuplicateGroup {
  /** Length only: the shared plaintext never leaves the service. */
  passwordLength: number;
  accounts: CountsAccountView[];
}

/**
 * Audits over the vault (spec 014). Read-only and both require the section unlocked: the
 * strength audit reads the persisted score (never brute-forces the vault) and the
 * duplicate audit decrypts each stored password with its own salt and groups equal
 * values. Nothing derived is persisted - no comparison hashes in the database.
 */
@Injectable()
export class CountsAuditsService {
  private readonly log = new Logger(CountsAuditsService.name);

  constructor(
    private readonly repo: CountsRepository,
    private readonly crypto: CryptoService,
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
    private readonly keys: SectionKeysService,
  ) {}

  /** AuthService owns unlock state; the passphrase is the single source for derivation. */
  private requireUnlocked(): string {
    const passphrase = this.auth.getSectionPassphrase(SECTION);
    if (!passphrase) throw new ForbiddenException('counts section is locked');
    return passphrase;
  }

  /** Reads the persisted score only: the audit never brute-forces the vault. */
  async weakAudit(): Promise<{ threshold: number; accounts: CountsAccountView[] }> {
    this.requireUnlocked();
    const threshold = this.weakThreshold();
    const accounts = await toViews(this.repo, await this.repo.findWeak(threshold));
    this.log.log('auditoria de fortaleza ejecutada', { threshold, accounts: accounts.length });
    return { threshold, accounts };
  }

  /** Groups accounts sharing a password; OAuth accounts without their own password are not read. */
  async duplicatesAudit(): Promise<CountsDuplicateGroup[]> {
    const passphrase = this.requireUnlocked();
    const rows = await this.repo.findWithStoredPassword();
    const byPassword = new Map<string, CountsAccountRow[]>();

    for (const row of rows) {
      const data = fieldCipher(row, 'password');
      if (!data) continue;
      try {
        const key = await this.keys.recordKey(passphrase, SECTION, row.salt);
        const plaintext = this.crypto.decrypt(data, key, secretAad(row.id, 'password'));
        byPassword.set(plaintext, [...(byPassword.get(plaintext) ?? []), row]);
      } catch (err: unknown) {
        this.log.warn(`auditoria de duplicados: cuenta ${row.id} no se pudo descifrar (${this.message(err)})`, {
          accountId: row.id,
        });
      }
    }

    const repeated = [...byPassword.entries()]
      .filter(([, accounts]) => accounts.length > 1)
      .sort((a, b) => b[1].length - a[1].length);
    const duplicates: CountsDuplicateGroup[] = [];

    for (const [plaintext, accounts] of repeated) {
      duplicates.push({ passwordLength: plaintext.length, accounts: await toViews(this.repo, accounts) });
    }

    this.log.log('auditoria de duplicados ejecutada', { scanned: rows.length, groups: duplicates.length });
    return duplicates;
  }

  /** Threshold is app config (settings table), so it is read per run and never cached. */
  private weakThreshold(): number {
    const stored = this.settings.get(WEAK_THRESHOLD_KEY);
    const value = typeof stored === 'number' ? stored : Number(stored);
    return Number.isFinite(value) ? value : DEFAULT_WEAK_THRESHOLD;
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}