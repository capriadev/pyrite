import type { CountsAccountPatch, CountsAccountRow } from '../../dal/counts/counts.repository';
import type { EncryptedData } from '../../services/crypto/crypto.service';

/** Secrets an account can carry, one encrypted column triple each. */
export const SECRET_FIELDS = [
  'password',
  'secretValue',
  'phrase',
  'twofaCodes',
  'securityQuestions',
] as const;

export type SecretField = (typeof SECRET_FIELDS)[number];

/** Single place mapping a domain field to its ciphertext/iv/authTag columns. */
const SECRET_COLUMN_READERS: Record<
  SecretField,
  (row: CountsAccountRow) => [string | null, string | null, string | null]
> = {
  password: (row) => [row.passwordCiphertext, row.passwordIv, row.passwordAuthTag],
  secretValue: (row) => [row.secretValueCiphertext, row.secretValueIv, row.secretValueAuthTag],
  phrase: (row) => [row.phraseCiphertext, row.phraseIv, row.phraseAuthTag],
  twofaCodes: (row) => [row.twofaCiphertext, row.twofaIv, row.twofaAuthTag],
  securityQuestions: (row) => [row.questionsCiphertext, row.questionsIv, row.questionsAuthTag],
};

export function isSecretField(value: string): value is SecretField {
  return (SECRET_FIELDS as readonly string[]).includes(value);
}

/** AAD binds each ciphertext to its row and field, so it cannot be swapped around. */
export function secretAad(id: string, field: SecretField): Buffer {
  return Buffer.from(`${id}:${field}`);
}

/** Reads a secret column triple; null when the account does not carry that secret. */
export function fieldCipher(row: CountsAccountRow, field: SecretField): EncryptedData | null {
  const [ciphertext, iv, authTag] = SECRET_COLUMN_READERS[field](row);
  if (!ciphertext || !iv || !authTag) return null;
  return { ciphertext, iv, authTag, salt: row.salt };
}

/** Column patch for one secret field; `null` clears the stored secret. */
export function encryptedPatch(field: SecretField, data: Omit<EncryptedData, 'salt'> | null): CountsAccountPatch {
  switch (field) {
    case 'password':
      return {
        passwordCiphertext: data?.ciphertext ?? null,
        passwordIv: data?.iv ?? null,
        passwordAuthTag: data?.authTag ?? null,
      };
    case 'secretValue':
      return {
        secretValueCiphertext: data?.ciphertext ?? null,
        secretValueIv: data?.iv ?? null,
        secretValueAuthTag: data?.authTag ?? null,
      };
    case 'phrase':
      return {
        phraseCiphertext: data?.ciphertext ?? null,
        phraseIv: data?.iv ?? null,
        phraseAuthTag: data?.authTag ?? null,
      };
    case 'twofaCodes':
      return {
        twofaCiphertext: data?.ciphertext ?? null,
        twofaIv: data?.iv ?? null,
        twofaAuthTag: data?.authTag ?? null,
      };
    case 'securityQuestions':
      return {
        questionsCiphertext: data?.ciphertext ?? null,
        questionsIv: data?.iv ?? null,
        questionsAuthTag: data?.authTag ?? null,
      };
  }
}