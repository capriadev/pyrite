import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { ApiKeysRepository, type ApiKeyRow } from '../dal/api-keys.repository';
import { CryptoService } from '../crypto/crypto.service';
import { AuthService } from '../auth/auth.service';

export interface CreateApiKeyInput {
  provider: string;
  label: string;
  key: string;
}

type ValidatorStatus = 'unchecked' | 'valid' | 'expired' | 'invalid';

/**
 * API keys domain: encrypted at rest (KDF + AES-GCM, medium profile),
 * gated by the 'apis' section unlock.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly repo: ApiKeysRepository,
    private readonly crypto: CryptoService,
    private readonly auth: AuthService,
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

  async validate(id: string): Promise<ValidatorStatus> {
    // decrypt the key, then validate via provider
    const key = await this.getValue(id);
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('api key not found');
    let status: ValidatorStatus = 'invalid';
    try {
      status = await this.providerValidate(row.provider, key);
    } catch {
      status = 'invalid';
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

  private mask(r: ApiKeyRow): Omit<ApiKeyRow, 'ciphertext' | 'iv' | 'authTag' | 'salt'> {
    const { ciphertext, iv, authTag, salt, ...rest } = r;
    return rest;
  }

  // Simple validators: ping a provider endpoint with the key. First pass:
  // openai, anthropic, github; 'custom' uses validation from caller context.
  private async providerValidate(provider: string, key: string): Promise<ValidatorStatus> {
    switch (provider) {
      case 'openai':
        return this.validateFetch('https://api.openai.com/v1/models', key);
      case 'anthropic':
        return this.validateFetch('https://api.anthropic.com/v1/models', key);
      case 'github':
        return this.validateFetch('https://api.github.com/user', key);
      default:
        return 'valid'; // custom: caller decided it's valid by adding it; no automatic check
    }
  }

  private async validateFetch(url: string, key: string): Promise<ValidatorStatus> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401 || res.status === 403) return 'invalid';
    if (res.ok) return 'valid';
    return 'invalid';
  }
}