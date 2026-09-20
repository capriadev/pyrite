import { credentialTypeEnum } from '../../../drizzle/schema';
import type { CredentialType } from '../../dal/counts/counts.repository';
import type { SecretField } from './counts-fields';

/**
 * Input contract of the counts vault plus its boundary guards. Validation lives here
 * so every entry point (the gateway today, other clients later) shares one source.
 */

/**
 * Secret inputs reuse the SECRET_FIELDS keys, so create/update loop over them instead
 * of repeating five blocks. `undefined` leaves a secret untouched, `null` or empty clears it.
 */
export type CountsAccountInput = {
  name?: string;
  kind?: string | null;
  url?: string | null;
  email?: string | null;
  username?: string | null;
  number?: string | null;
  notes?: string | null;
  credentialType?: CredentialType;
  oauthEnabled?: boolean;
  oauthSrcAccountId?: string | null;
  groupIds?: string[];
} & Partial<Record<SecretField, string | null>>;

/** Allowed values come from the schema enum: one source of truth for credential types. */
export function isCredentialType(value: string): value is CredentialType {
  return (credentialTypeEnum.enumValues as readonly string[]).includes(value);
}