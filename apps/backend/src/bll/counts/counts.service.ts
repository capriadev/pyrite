import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import {
  CountsRepository,
  type CountsAccountPatch,
  type CountsAccountRow,
  type CountsListFilters,
  type CredentialType,
} from '../../dal/counts/counts.repository';
import { countsPasswordHistory } from '../../../drizzle/schema';
import { CryptoService } from '../../services/crypto/crypto.service';
import { AuthService } from '../auth/auth.service';
import { GroupsService } from '../groups/groups.service';
import { SettingsService } from '../settings/settings.service';
import {
  SECRET_FIELDS,
  encryptedPatch,
  fieldCipher,
  isSecretField,
  secretAad,
  type SecretField,
} from './counts-fields';
import { scorePassword } from './password-strength';
import { isUuid, type CountsAccountInput } from './counts-input';

const SECTION = 'counts';
const WEAK_THRESHOLD_KEY = 'counts.weak_threshold';
/** Fallback used until the threshold is set from the settings UI. */
const DEFAULT_WEAK_THRESHOLD = 50;

/** Metadata-only projection of an account: no secret column crosses this boundary. */
export interface CountsAccountView {
  id: string;
  name: string;
  kind: string | null;
  url: string | null;
  email: string | null;
  username: string | null;
  number: string | null;
  notes: string | null;
  credentialType: CredentialType;
  oauthEnabled: boolean;
  oauthSrcAccountId: string | null;
  strengthScore: number | null;
  lastPasswordChangedAt: Date | null;
  /** Presence of each encrypted column, derived without decrypting anything. */
  indicators: Record<SecretField, boolean>;
  groups: Array<{ id: string; name: string }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CountsDuplicateGroup {
  /** Length only: the shared plaintext never leaves the service. */
  passwordLength: number;
  accounts: CountsAccountView[];
}

/**
 * Counts vault (spec 012). Metadata stays readable while locked; secrets are
 * decrypted only on reveal, history and audits, and only while the section is unlocked.
 */
@Injectable()
export class CountsService {
  private readonly log = new Logger(CountsService.name);

  constructor(
    private readonly repo: CountsRepository,
    private readonly crypto: CryptoService,
    private readonly auth: AuthService,
    private readonly groups: GroupsService,
    private readonly settings: SettingsService,
  ) {}

  // ============ ACCESS ============

  /** AuthService owns unlock state; the passphrase is the single source for derivation. */
  private requireUnlocked(): string {
    const passphrase = this.auth.getSectionPassphrase(SECTION);
    if (!passphrase) throw new ForbiddenException('counts section is locked');
    return passphrase;
  }

  /** One salt per account: the heavy KDF runs once and serves every secret column of the row. */
  private deriveAccountKey(passphrase: string, salt: string): Promise<Buffer> {
    return this.crypto.deriveKey(passphrase, SECTION, Buffer.from(salt, 'base64'));
  }

  private async requireAccount(id: string): Promise<CountsAccountRow> {
    const row = await this.repo.findById(id);
    if (!row || row.status !== 'active') throw new NotFoundException('account not found');
    return row;
  }

  /** Encrypts only the secrets present in the payload; undefined means "leave as is". */
  private async encryptSecrets(input: CountsAccountInput, id: string, key: Buffer): Promise<CountsAccountPatch> {
    const patch: CountsAccountPatch = {};
    for (const field of SECRET_FIELDS) {
      const value = input[field];
      if (value === undefined) continue;
      if (value === null || value.trim() === '') {
        Object.assign(patch, encryptedPatch(field, null));
        continue;
      }
      Object.assign(patch, encryptedPatch(field, this.crypto.encrypt(value, key, secretAad(id, field))));
    }
    return patch;
  }

  // ============ READ ============

  /** List and search run on plaintext metadata, so they work while the section is locked. */
  async list(filters: CountsListFilters = {}): Promise<CountsAccountView[]> {
    return this.toViews(await this.repo.findActive(filters));
  }

  async get(id: string): Promise<CountsAccountView> {
    return this.viewOne(await this.requireAccount(id));
  }

  // ============ CREATE ============

  async create(input: CountsAccountInput): Promise<CountsAccountView> {
    const passphrase = this.requireUnlocked();
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('name is required');
    await this.assertOauthSource(input.oauthSrcAccountId ?? null);

    const id = randomUUID();
    const salt = randomBytes(16);
    const key = await this.crypto.deriveKey(passphrase, SECTION, salt);
    const row = await this.repo.create({
      id,
      name,
      kind: input.kind ?? null,
      url: input.url ?? null,
      email: input.email ?? null,
      username: input.username ?? null,
      number: input.number ?? null,
      notes: input.notes ?? null,
      credentialType: input.credentialType ?? 'password',
      oauthEnabled: input.oauthEnabled ? 'true' : 'false',
      oauthSrcAccountId: input.oauthSrcAccountId ?? null,
      salt: salt.toString('base64'),
      strengthScore: input.password ? String(scorePassword(input.password)) : null,
      lastPasswordChangedAt: input.password ? new Date() : null,
      ...(await this.encryptSecrets(input, id, key)),
    });

    if (input.groupIds) await this.applyGroups(row.id, input.groupIds);
    this.log.log('cuenta creada', { accountId: row.id, credentialType: row.credentialType });
    return this.viewOne(row);
  }

  /** An OAuth credential may only point at an existing OAuth-enabled account. */
  private async assertOauthSource(accountId: string | null): Promise<void> {
    if (!accountId) return;
    if (!isUuid(accountId)) throw new BadRequestException('invalid oauth source account id');
    const row = await this.repo.findById(accountId);
    if (!row || row.status !== 'active') throw new BadRequestException('oauth source account not found');
    if (row.oauthEnabled !== 'true') throw new BadRequestException('oauth source account is not oauth-enabled');
  }

  // ============ UPDATE ============

  async update(id: string, input: CountsAccountInput): Promise<CountsAccountView> {
    const passphrase = this.requireUnlocked();
    const row = await this.requireAccount(id);
    const patch: CountsAccountPatch = {};

    if (input.name !== undefined) {
      const name = (input.name ?? '').trim();
      if (!name) throw new BadRequestException('name is required');
      patch.name = name;
    }
    if (input.kind !== undefined) patch.kind = input.kind ?? null;
    if (input.url !== undefined) patch.url = input.url ?? null;
    if (input.email !== undefined) patch.email = input.email ?? null;
    if (input.username !== undefined) patch.username = input.username ?? null;
    if (input.number !== undefined) patch.number = input.number ?? null;
    if (input.notes !== undefined) patch.notes = input.notes ?? null;
    if (input.credentialType !== undefined) patch.credentialType = input.credentialType;
    if (input.oauthEnabled !== undefined) patch.oauthEnabled = input.oauthEnabled ? 'true' : 'false';
    if (input.oauthSrcAccountId !== undefined) {
      await this.assertOauthSource(input.oauthSrcAccountId ?? null);
      patch.oauthSrcAccountId = input.oauthSrcAccountId ?? null;
    }

    const key = await this.deriveAccountKey(passphrase, row.salt);
    Object.assign(patch, await this.encryptSecrets(input, row.id, key));

    if (input.password !== undefined) {
      patch.strengthScore = input.password ? String(scorePassword(input.password)) : null;
      patch.lastPasswordChangedAt = input.password ? new Date() : null;
    }

    // The stored password is never overwritten in place: it moves to history first,
    // also when the payload clears it, so a value cannot be lost silently.
    if (input.password !== undefined && row.passwordCiphertext !== null) {
      await this.repo.rotatePassword(id, await this.buildHistoryRow(row, key, passphrase), patch);
    } else {
      await this.repo.update(id, patch);
    }

    this.log.log('cuenta actualizada', { accountId: id, fields: Object.keys(patch) });
    if (input.groupIds !== undefined) await this.applyGroups(id, input.groupIds);
    return this.viewOne(await this.requireAccount(id));
  }

  /**
   * Copies the current password into history under its own salt. Costs one extra
   * heavy derivation per change; in exchange the history row is self-contained.
   */
  private async buildHistoryRow(
    row: CountsAccountRow,
    currentKey: Buffer,
    passphrase: string,
  ): Promise<typeof countsPasswordHistory.$inferInsert> {
    const current = fieldCipher(row, 'password');
    if (!current) throw new InternalServerErrorException('stored password is not readable');
    const plaintext = this.crypto.decrypt(current, currentKey, secretAad(row.id, 'password'));
    const id = randomUUID();
    const salt = randomBytes(16);
    const key = await this.crypto.deriveKey(passphrase, SECTION, salt);
    const encrypted = this.crypto.encrypt(plaintext, key, secretAad(id, 'password'));
    return {
      id,
      accountId: row.id,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      salt: salt.toString('base64'),
    };
  }

  /** Tags are validated against the counts-domain groups before the swap. */
  private async applyGroups(accountId: string, groupIds: string[]): Promise<void> {
    if (groupIds.some((groupId) => !isUuid(groupId))) throw new BadRequestException('invalid group id');
    const known = new Set((await this.groups.list(SECTION)).map((group) => group.id));
    if (groupIds.some((groupId) => !known.has(groupId))) throw new BadRequestException('unknown group');
    await this.repo.replaceGroups(accountId, [...new Set(groupIds)]);
  }

  // ============ REVEAL ============

  /** Decrypts on demand: a single field, or every field the account carries. */
  async reveal(id: string, field?: string): Promise<Partial<Record<SecretField, string>>> {
    const passphrase = this.requireUnlocked();
    if (field !== undefined && !isSecretField(field)) throw new BadRequestException('invalid field');
    const row = await this.requireAccount(id);
    const key = await this.deriveAccountKey(passphrase, row.salt);
    const revealed: Partial<Record<SecretField, string>> = {};

    for (const current of field ? [field] : SECRET_FIELDS) {
      const data = fieldCipher(row, current);
      if (!data) continue;
      try {
        revealed[current] = this.crypto.decrypt(data, key, secretAad(row.id, current));
      } catch (err: unknown) {
        this.log.error(`descifrado de la cuenta ${id} fallo en ${current}: ${this.message(err)}`, {
          accountId: id,
          field: current,
        });
        throw err;
      }
    }

    this.log.log('campos revelados', { accountId: id, fields: Object.keys(revealed) });
    return revealed;
  }

  /** Previous passwords, newest first, each one decrypted with its own salt. */
  async history(id: string): Promise<Array<{ id: string; password: string; changedAt: Date }>> {
    const passphrase = this.requireUnlocked();
    await this.requireAccount(id);
    const rows = await this.repo.findHistory(id);
    const entries: Array<{ id: string; password: string; changedAt: Date }> = [];

    for (const row of rows) {
      const key = await this.deriveAccountKey(passphrase, row.salt);
      try {
        entries.push({
          id: row.id,
          password: this.crypto.decrypt(
            { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, salt: row.salt },
            key,
            secretAad(row.id, 'password'),
          ),
          changedAt: row.changedAt,
        });
      } catch (err: unknown) {
        this.log.warn(`historial de ${id}: entrada ${row.id} no se pudo descifrar (${this.message(err)})`, {
          accountId: id,
          historyId: row.id,
        });
      }
    }

    return entries;
  }

  // ============ AUDITS ============

  /** Reads the persisted score only: the audit never brute-forces the vault. */
  async weakAudit(): Promise<{ threshold: number; accounts: CountsAccountView[] }> {
    this.requireUnlocked();
    const threshold = this.weakThreshold();
    const accounts = await this.toViews(await this.repo.findWeak(threshold));
    this.log.log('auditoria de fortaleza ejecutada', { threshold, accounts: accounts.length });
    return { threshold, accounts };
  }

  /**
   * Groups accounts sharing a password. Each stored password is decrypted with its own
   * salt (OAuth accounts without their own password are not even read), and nothing
   * derived is persisted: no comparison hashes in the database.
   */
  async duplicatesAudit(): Promise<CountsDuplicateGroup[]> {
    const passphrase = this.requireUnlocked();
    const rows = await this.repo.findWithStoredPassword();
    const byPassword = new Map<string, CountsAccountRow[]>();

    for (const row of rows) {
      const data = fieldCipher(row, 'password');
      if (!data) continue;
      try {
        const key = await this.deriveAccountKey(passphrase, row.salt);
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
      duplicates.push({ passwordLength: plaintext.length, accounts: await this.toViews(accounts) });
    }

    this.log.log('auditoria de duplicados ejecutada', { scanned: rows.length, groups: duplicates.length });
    return duplicates;
  }

  // ============ ITEM OPS ============

  async remove(id: string): Promise<void> {
    this.requireUnlocked();
    await this.requireAccount(id);
    await this.repo.softDelete(id);
    this.log.log('cuenta eliminada (soft)', { accountId: id });
  }

  async setGroups(id: string, groupIds: string[]): Promise<CountsAccountView> {
    this.requireUnlocked();
    await this.requireAccount(id);
    await this.applyGroups(id, groupIds);
    return this.viewOne(await this.requireAccount(id));
  }

  // ============ GROUPS (delegated to the shared service, domain 'counts') ============

  listGroups() {
    return this.groups.list(SECTION);
  }

  createGroup(name: string) {
    return this.groups.create(SECTION, name);
  }

  removeGroup(id: string): Promise<void> {
    return this.groups.remove(SECTION, id);
  }

  // ============ HELPERS ============

  /** The threshold is app config (settings table, editable from the UI), not .env. */
  private weakThreshold(): number {
    const stored = this.settings.get(WEAK_THRESHOLD_KEY);
    const value = typeof stored === 'number' ? stored : Number(stored);
    return Number.isFinite(value) ? value : DEFAULT_WEAK_THRESHOLD;
  }

  private async viewOne(row: CountsAccountRow): Promise<CountsAccountView> {
    return (await this.toViews([row]))[0];
  }

  private async toViews(rows: CountsAccountRow[]): Promise<CountsAccountView[]> {
    const tags = await this.repo.findTags(rows.map((row) => row.id));
    const byAccount = new Map<string, Array<{ id: string; name: string }>>();
    for (const tag of tags) {
      byAccount.set(tag.accountId, [
        ...(byAccount.get(tag.accountId) ?? []),
        { id: tag.groupId, name: tag.name },
      ]);
    }
    return rows.map((row) => this.toView(row, byAccount.get(row.id) ?? []));
  }

  /** Metadata-only mapping: indicators come from ciphertext presence, not decryption. */
  private toView(row: CountsAccountRow, groups: Array<{ id: string; name: string }>): CountsAccountView {
    const indicators = {} as Record<SecretField, boolean>;
    for (const field of SECRET_FIELDS) {
      indicators[field] = fieldCipher(row, field) !== null;
    }
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      url: row.url,
      email: row.email,
      username: row.username,
      number: row.number,
      notes: row.notes,
      credentialType: row.credentialType,
      oauthEnabled: row.oauthEnabled === 'true',
      oauthSrcAccountId: row.oauthSrcAccountId,
      strengthScore: row.strengthScore === null ? null : Number(row.strengthScore),
      lastPasswordChangedAt: row.lastPasswordChangedAt,
      indicators,
      groups,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}