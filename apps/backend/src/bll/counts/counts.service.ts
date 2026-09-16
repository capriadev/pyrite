import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { CountsRepository, type CountsAccountPatch, type CountsAccountRewrite, type CountsAccountRow, type CountsHistoryRewrite, type CountsListFilters } from '../../dal/counts/counts.repository';
import { RotationRepository, type RotationStagingRow } from '../../dal/rotation/rotation.repository';
import type { DrizzleTx } from '../../dal/drizzle.provider';
import { countsPasswordHistory } from '../../../drizzle/schema';
import { CryptoService, type EncryptedData } from '../../services/crypto/crypto.service';
import { AuthService } from '../auth/auth.service';
import { GroupsService } from '../groups/groups.service';
import { SectionKeysService } from '../../services/crypto/section-keys';
import { SectionWriteGuard } from '../rotation/section-write-guard';
import type { SectionRotator, StageReporter } from '../rotation/section-rotator';
import { SECRET_FIELDS, encryptedPatch, fieldCipher, isSecretField, secretAad, type SecretField } from './counts-fields';
import { toViews, type CountsAccountView } from './counts-view';
import { scorePassword } from './password-strength';
import { isUuid, type CountsAccountInput } from './counts-input';

const SECTION = 'counts';

/** Physical tables a rotation of this section writes back: the account and its history. */
const COUNT_ACCOUNTS_TABLE = 'counts_accounts';
const COUNT_HISTORY_TABLE = 'counts_password_history';

/**
 * Counts vault (spec 012). Metadata stays readable while locked; secrets are
 * decrypted only on reveal and history, and only while the section is unlocked. The
 * audits live in `CountsAuditsService` (spec 014) and the view projection in `counts-view`.
 */
@Injectable()
export class CountsService {
  private readonly log = new Logger(CountsService.name);

  /**
   * The section as a rotator (spec 013). Its unit is the account - the five secret column sets
   * share one key - plus one unit per history row, which carries a salt of its own.
   */
  readonly rotators: SectionRotator[] = [
    {
      section: SECTION,
      countUnits: () => this.countUnits(),
      stage: (jobId, from, to, report) => this.stageSection(jobId, from, to, report),
      apply: (tx, staged) => this.applySection(tx, staged),
    },
  ];

  constructor(
    private readonly repo: CountsRepository,
    private readonly crypto: CryptoService,
    private readonly auth: AuthService,
    private readonly groups: GroupsService,
    private readonly keys: SectionKeysService,
    private readonly rotation: RotationRepository,
    private readonly guard: SectionWriteGuard,
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
    return this.keys.recordKey(passphrase, SECTION, salt);
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
    return toViews(this.repo, await this.repo.findActive(filters));
  }

  async get(id: string): Promise<CountsAccountView> {
    return this.viewOne(await this.requireAccount(id));
  }

  // ============ CREATE ============

  async create(input: CountsAccountInput): Promise<CountsAccountView> {
    this.guard.assertWritable(SECTION);
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
    this.guard.assertWritable(SECTION);
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

    if (input.groupIds !== undefined) await this.applyGroups(id, input.groupIds);
    this.log.log('cuenta actualizada', { accountId: id, fields: Object.keys(patch) });
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

  // ============ ITEM OPS ============

  async remove(id: string): Promise<void> {
    this.guard.assertWritable(SECTION);
    this.requireUnlocked();
    await this.requireAccount(id);
    await this.repo.softDelete(id);
    this.log.log('cuenta eliminada (soft)', { accountId: id });
  }

  async setGroups(id: string, groupIds: string[]): Promise<CountsAccountView> {
    this.guard.assertWritable(SECTION);
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
  // ============ ROTATION (spec 013) ============

  /**
   * Work units: the accounts that carry at least one secret column, plus every history row.
   * The account is one unit because its five column sets share a single key; a history row is
   * another one because it carries a salt of its own.
   */
  private async countUnits(): Promise<number> {
    const accounts = await this.repo.findForRotation();
    const history = await this.repo.findHistoryForRotation();
    return accounts.filter((row) => this.carriesSecret(row)).length + history.length;
  }

  /**
   * One heavy derivation per account, then one per history row. Salts are not rotated - the key
   * changes because the passphrase changes - so only the ciphertext columns are staged. Live
   * rows keep answering to the old passphrase until the apply commits, and units already staged
   * are skipped so a resume reuses the work.
   */
  private async stageSection(
    jobId: string,
    from: string,
    to: string,
    report: StageReporter,
  ): Promise<number> {
    const accounts = await this.repo.findForRotation();
    const history = await this.repo.findHistoryForRotation();
    if (accounts.length === 0 && history.length === 0) return 0;

    const already = await this.stagedUnitIds(jobId);
    const alreadyStaged = already.size;
    let staged = alreadyStaged;

    for (const row of accounts) {
      if (already.has(this.unitKey(COUNT_ACCOUNTS_TABLE, row.id))) continue;
      const secrets = this.secretEntries(row);
      if (secrets.length === 0) continue;

      const oldKey = await this.deriveAccountKey(from, row.salt);
      const newKey = await this.deriveAccountKey(to, row.salt);
      const patch: CountsAccountPatch = {};
      for (const [field, cipher] of secrets) {
        const plaintext = this.crypto.decrypt(cipher, oldKey, secretAad(row.id, field));
        const reencrypted = this.crypto.encrypt(plaintext, newKey, secretAad(row.id, field));
        Object.assign(patch, encryptedPatch(field, reencrypted));
      }

      await this.rotation.stageRow(jobId, {
        targetTable: COUNT_ACCOUNTS_TABLE,
        rowId: row.id,
        payload: patch as unknown as Record<string, unknown>,
      });
      staged += 1;
      await report(staged);
    }

    for (const row of history) {
      if (already.has(this.unitKey(COUNT_HISTORY_TABLE, row.id))) continue;

      const oldKey = await this.deriveAccountKey(from, row.salt);
      const newKey = await this.deriveAccountKey(to, row.salt);
      const cipher = {
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.authTag,
        salt: row.salt,
      };
      const plaintext = this.crypto.decrypt(cipher, oldKey, secretAad(row.id, 'password'));
      const reencrypted = this.crypto.encrypt(plaintext, newKey, secretAad(row.id, 'password'));

      await this.rotation.stageRow(jobId, {
        targetTable: COUNT_HISTORY_TABLE,
        rowId: row.id,
        payload: {
          ciphertext: reencrypted.ciphertext,
          iv: reencrypted.iv,
          authTag: reencrypted.authTag,
        },
      });
      staged += 1;
      await report(staged);
    }

    return staged - alreadyStaged;
  }

  /** Write-back inside the apply transaction: the secret column sets and the history rows. */
  private async applySection(tx: DrizzleTx, staged: RotationStagingRow[]): Promise<number> {
    const accounts: CountsAccountRewrite[] = staged
      .filter((row) => row.targetTable === COUNT_ACCOUNTS_TABLE)
      .map((row) => ({ id: row.rowId, patch: row.payload as CountsAccountPatch }));
    const history: CountsHistoryRewrite[] = staged
      .filter((row) => row.targetTable === COUNT_HISTORY_TABLE)
      .map((row) => ({
        id: row.rowId,
        ciphertext: row.payload.ciphertext as string,
        iv: row.payload.iv as string,
        authTag: row.payload.authTag as string,
      }));
    return this.repo.applyRotation(tx, accounts, history);
  }

  /** Units already staged for this job, keyed by table and row, so a resume skips them. */
  private async stagedUnitIds(jobId: string): Promise<Set<string>> {
    const staged = await this.rotation.listStaged(jobId);
    return new Set(staged.map((row) => this.unitKey(row.targetTable, row.rowId)));
  }

  /** The account table is only one of the sections a job can stage, so units key on both. */
  private unitKey(table: string, rowId: string): string {
    return `${table}:${rowId}`;
  }

  /** Secret columns the account really carries, paired with the field they belong to. */
  private secretEntries(row: CountsAccountRow): Array<[SecretField, EncryptedData]> {
    const entries: Array<[SecretField, EncryptedData]> = [];
    for (const field of SECRET_FIELDS) {
      const cipher = fieldCipher(row, field);
      if (cipher) entries.push([field, cipher]);
    }
    return entries;
  }

  private carriesSecret(row: CountsAccountRow): boolean {
    return SECRET_FIELDS.some((field) => fieldCipher(row, field) !== null);
  }

  private async viewOne(row: CountsAccountRow): Promise<CountsAccountView> {
    return (await toViews(this.repo, [row]))[0];
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}