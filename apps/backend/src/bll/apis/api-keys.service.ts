import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { ApiKeysRepository, type ApiKeyRow } from '../../dal/apis/api-keys.repository';
import { CryptoService } from '../../services/crypto/crypto.service';
import { AuthService } from '../auth/auth.service';
import { GroupsService } from '../groups/groups.service';
import { getProviderClient } from '../../integrations/providers/index';
import { type ProviderStatus } from '../../integrations/providers/provider.types';

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
  constructor(
    private readonly repo: ApiKeysRepository,
    private readonly crypto: CryptoService,
    private readonly auth: AuthService,
    private readonly groups: GroupsService,
  ) {}

  private requireUnlocked(): string {
    const passphrase = this.auth.getSectionPassphrase('apis');
    if (!passphrase) throw new ForbiddenException('apis section is locked');
    return passphrase;
  }

  async create(input: CreateApiKeyInput): Promise<ApiKeyRow> {
    const passphrase = this.requireUnlocked();
    const id = randomUUID();
    const salt = randomBytes(16);
    const key = await this.crypto.deriveKey(passphrase, 'apis', salt);
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
    const key = await this.crypto.deriveKey(passphrase, 'apis', salt);
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
    await this.repo.softDelete(id);
  }

  async updateLabel(id: string, label: string): Promise<void> {
    await this.repo.updateLabel(id, label);
  }

  async updateDetail(id: string, detail: string): Promise<void> {
    await this.repo.updateDetail(id, detail);
  }

  async moveToGroup(id: string, groupId: string | null): Promise<void> {
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

  private mask(r: ApiKeyRow): Omit<ApiKeyRow, 'ciphertext' | 'iv' | 'authTag' | 'salt'> {
    const { ciphertext, iv, authTag, salt, ...rest } = r;
    return rest;
  }
}
