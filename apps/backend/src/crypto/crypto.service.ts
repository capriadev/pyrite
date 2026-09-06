import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { SECTION_CRYPTO_CONFIG, LOGIN_PEPPER, LOGIN_PROFILE, type SectionName } from './crypto-config';

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
}

export interface CanaryData {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
}

@Injectable()
export class CryptoService {
  /**
   * ========== HASH (login, one-way verification) ==========
   */
  async hashPassword(password: string): Promise<{ hash: string; salt: string }> {
    const salt = randomBytes(16);
    const hash = await argon2.hash(password + LOGIN_PEPPER, {
      type: argon2.argon2id,
      memoryCost: LOGIN_PROFILE.memoryCost,
      timeCost: LOGIN_PROFILE.timeCost,
      parallelism: LOGIN_PROFILE.parallelism,
      salt,
      raw: false,
    });
    return { hash, salt: salt.toString('base64') };
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return argon2.verify(hash, password + LOGIN_PEPPER);
  }

  /**
   * ========== KDF (key derivation for reversible encryption) ==========
   * Derives a 256-bit AES key from passphrase + pepper + salt.
   * Salt is per-record; the caller decides whether to reuse or generate fresh.
   */
  async deriveKey(passphrase: string, section: SectionName, salt: Buffer): Promise<Buffer> {
    const config = SECTION_CRYPTO_CONFIG[section];
    return argon2.hash(passphrase + config.pepper, {
      type: argon2.argon2id,
      memoryCost: config.profile.memoryCost,
      timeCost: config.profile.timeCost,
      parallelism: config.profile.parallelism,
      salt,
      raw: true,
      hashLength: 32,
    });
  }

  /**
   * ========== AES-256-GCM (symmetric reversible encryption) ==========
   * Key must already be derived (by the caller, stored in memory per section).
   */
  encrypt(plaintext: string, key: Buffer, aad: Buffer): EncryptedData {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      salt: '',
    };
  }

  decrypt(data: EncryptedData, key: Buffer, aad: Buffer): string {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'base64'));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(data.authTag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(data.ciphertext, 'base64')), decipher.final()]);
    return plain.toString('utf8');
  }

  /**
   * ========== Canary (passphrase verification via GCM authTag) ==========
   * Create a canary by encrypting a known phrase with the section key.
   * Verify by attempting to decrypt the canary with the same key.
   */
  async createCanary(passphrase: string, section: SectionName): Promise<CanaryData> {
    const salt = randomBytes(16);
    const key = await this.deriveKey(passphrase, section, salt);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const canaryPlain = '__PYRITE_CANARY__';
    const encrypted = Buffer.concat([cipher.update(canaryPlain, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      salt: salt.toString('base64'),
    };
  }

  async verifyCanary(passphrase: string, section: SectionName, canary: CanaryData): Promise<boolean> {
    try {
      const key = await this.deriveKey(passphrase, section, Buffer.from(canary.salt, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(canary.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(canary.authTag, 'base64'));
      const plain = Buffer.concat([decipher.update(Buffer.from(canary.ciphertext, 'base64')), decipher.final()]);
      return plain.toString('utf8') === '__PYRITE_CANARY__';
    } catch {
      return false;
    }
  }
}