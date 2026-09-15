import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import {
  ApiKeysRepository,
  type ApiKeyRewrite,
  type ApiKeyRow,
} from '../../dal/apis/api-keys.repository';
import { RotationRepository, type RotationStagingRow } from '../../dal/rotation/rotation.repository';
import type { DrizzleTx } from '../../dal/drizzle.provider';
import { CryptoService } from '../../services/crypto/crypto.service';
import { SectionKeysService } from '../../services/crypto/section-keys';
import { AuthService } from '../auth/auth.service';
import { GroupsService } from '../groups/groups.service';
import { SectionWriteGuard } from '../rotation/section-write-guard';
import type { SectionRotator, StageReporter } from '../rotation/section-rotator';
import { getProviderClient } from '../../integrations/providers/index';
import { type ProviderStatus } from '../../integrations/providers/provider.types';

/** Physical table of the section: what the staged units of a rotation target. */
const APIS_TABLE = 'api_keys';

export interface CreateApiKeyInput {
  provider: string;
  label: string;
  key: string;
  detail?: string | null;
  groupId?: string | null;
}

export interface CreateGroupInput {
  name: string;
}

@Injectable()
export class ApiKeysService {
  /**
   * The section as a rotator (spec 013). One unit per record: `apis` keeps a salt per record,
   * so the rotation derives a key for each row instead of one key for the whole section.
   */
  readonly rotators: SectionRotator[] = [
    {
      section: 'apis',
      countUnits: () => this.countUnits(),
      stage: (jobId, from, to, report) => this.stageSection(jobId, from, to, report),
      apply: (tx, staged) => this.applySection(tx, staged),
    },
  ];

  constructor(
    private readonly repo: ApiKeysRepository,
    private readonly crypto: CryptoService,
    private readonly auth: AuthService,
    private readonly groups: GroupsService,
    private readonly keys: SectionKeysService,
    private readonly rotation: RotationRepository,
    private readonly guard: SectionWriteGuard,
  ) {}

  private requireUnlocked(): string {
    const passphrase = this.auth.getSectionPassphrase('apis');
    if (!passphrase) throw new ForbiddenException('apis section is locked');
    return passphrase;
  }

  async create(input: CreateApiKeyInput): Promise<ApiKeyRow> {
    const passphrase = this.requireUnlocked();
    this.guard.assertWritable('apis');
    const id = randomUUID();
    const salt = randomBytes(16);
    const key = await this.keys.recordKey(passphrase, 'apis', salt);
    const encrypted = this.crypto.encrypt(input.key, key, Buffer.from(id));
    return this.repo.create({
      id,
      provider: input.provider,
      label: input.label,
      detail: input.detail ?? null,
      groupId: input.groupId ?? null,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      salt: salt.toString('base64'),
    });
  }

  async list(): Promise<Array<Omit<ApiKeyRow, 'ciphertext' | 'iv' | 'authTag' | 'salt'>>> {
    const rows = await this.repo.findActive();
    return rows.map((r) => this.mask(r));
  }

  async getValue(id: string): Promise<string> {
    const passphrase = this.requireUnlocked();
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('api key not found');
    const salt = Buffer.from(row.salt, 'base64');
    const key = await this.keys.recordKey(passphrase, 'apis', salt);
    return this.crypto.decrypt(
      { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, salt: row.salt },
      key,
      Buffer.from(row.id),
    );
  }

  async validate(id: string): Promise<ProviderStatus> {
    const key = await this.getValue(id);
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('api key not found');
    const client = getProviderClient(row.provider);
    let status: ProviderStatus = 'unchecked';
    if (client) {
      try {
        status = await client.validate(key);
      } catch {
        status = 'invalid';
      }
    }
    await this.repo.updateValidator(id, status, new Date());
    return status;
  }

  async remove(id: string): Promise<void> {
    this.guard.assertWritable('apis');
    await this.repo.softDelete(id);
  }

  async updateLabel(id: string, label: string): Promise<void> {
    this.guard.assertWritable('apis');
    await this.repo.updateLabel(id, label);
  }

  async updateDetail(id: string, detail: string): Promise<void> {
    this.guard.assertWritable('apis');
    await this.repo.updateDetail(id, detail);
  }

  async moveToGroup(id: string, groupId: string | null): Promise<void> {
    this.guard.assertWritable('apis');
    await this.repo.updateGroup(id, groupId);
  }

  // ============ GROUPS (delegated to shared GroupsService, domain 'apis') ============

  listGroups() {
    return this.groups.list('apis');
  }

  createGroup(input: CreateGroupInput) {
    return this.groups.create('apis', input.name);
  }

  removeGroup(id: string): Promise<void> {
    return this.groups.remove('apis', id);
  }

  // ============ ROTATION (spec 013) ============

  /** One unit per record: without a shared salt every key is derived on its own. */
  private async countUnits(): Promise<number> {
    return (await this.repo.findForRotation()).length;
  }

  /**
   * Decrypts each record with `from`, encrypts it with `to` and stages the result. The salt of
   * the record is part of its key material and is not rotated, so only the ciphertext columns
   * travel. Live rows are untouched: the old passphrase keeps opening the section until the
   * apply commits. Rows already staged are skipped, which is what makes a resume cheap.
   */
  private async stageSection(
    jobId: string,
    from: string,
    to: string,
    report: StageReporter,
  ): Promise<number> {
    const rows = await this.repo.findForRotation();
    if (rows.length === 0) return 0;

    const already = await this.stagedRecordIds(jobId);
    let staged = 0;
    for (const row of rows) {
      if (already.has(row.id)) continue;
      const aad = Buffer.from(row.id);
      const oldKey = await this.keys.recordKey(from, 'apis', row.salt);
      const newKey = await this.keys.recordKey(to, 'apis', row.salt);
      const content = this.crypto.decrypt(
        { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, salt: row.salt },
        oldKey,
        aad,
      );
      const encrypted = this.crypto.encrypt(content, newKey, aad);
      await this.rotation.stageRow(jobId, {
        targetTable: APIS_TABLE,
        rowId: row.id,
        payload: {
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
        },
      });
      staged += 1;
      await report(staged);
    }

    return staged;
  }

  /** Write-back inside the apply transaction: ciphertext, iv and tag; the salt stays as is. */
  private async applySection(tx: DrizzleTx, staged: RotationStagingRow[]): Promise<number> {
    const rows: ApiKeyRewrite[] = staged
      .filter((row) => row.targetTable === APIS_TABLE)
      .map((row) => ({
        id: row.rowId,
        ciphertext: row.payload.ciphertext as string,
        iv: row.payload.iv as string,
        authTag: row.payload.authTag as string,
      }));
    return this.repo.applyRotation(tx, rows);
  }

  /** Records already staged for this job, so a resume never re-derives what is durable. */
  private async stagedRecordIds(jobId: string): Promise<Set<string>> {
    const staged = await this.rotation.listStaged(jobId);
    return new Set(staged.filter((row) => row.targetTable === APIS_TABLE).map((row) => row.rowId));
  }

  private mask(r: ApiKeyRow): Omit<ApiKeyRow, 'ciphertext' | 'iv' | 'authTag' | 'salt'> {
    const { ciphertext, iv, authTag, salt, ...rest } = r;
    return rest;
  }
}
