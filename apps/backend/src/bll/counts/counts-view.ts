import type { CountsAccountRow, CountsRepository, CredentialType } from '../../dal/counts/counts.repository';
import { SECRET_FIELDS, fieldCipher, type SecretField } from './counts-fields';

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

/**
 * View mapping shared by the CRUD paths and the audits, so the projection exists once.
 * Tags are read through the repository the caller passes in, which keeps this module a
 * pure mapper with no DI of its own.
 */

/** Metadata-only mapping: indicators come from ciphertext presence, not decryption. */
export function toView(row: CountsAccountRow, groups: Array<{ id: string; name: string }>): CountsAccountView {
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

/** Tags are fetched once for the whole batch instead of once per row. */
export async function toViews(repo: CountsRepository, rows: CountsAccountRow[]): Promise<CountsAccountView[]> {
  const tags = await repo.findTags(rows.map((row) => row.id));
  const byAccount = new Map<string, Array<{ id: string; name: string }>>();
  for (const tag of tags) {
    byAccount.set(tag.accountId, [
      ...(byAccount.get(tag.accountId) ?? []),
      { id: tag.groupId, name: tag.name },
    ]);
  }
  return rows.map((row) => toView(row, byAccount.get(row.id) ?? []));
}