import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNotNull, lte, or } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb, type DrizzleTx } from '../drizzle.provider';
import {
  countsAccountGroups,
  countsAccounts,
  countsPasswordHistory,
  groups,
} from '../../../drizzle/schema';

/**
 * Row types are derived from the schema instead of hand-written: the table already
 * declares nullability and enums, so a manual mapper would only duplicate columns.
 */
export type CountsAccountRow = typeof countsAccounts.$inferSelect;
export type CountsHistoryRow = typeof countsPasswordHistory.$inferSelect;
export type CountsAccountPatch = Partial<typeof countsAccounts.$inferInsert>;
export type CredentialType = CountsAccountRow['credentialType'];

export interface CountsListFilters {
  q?: string;
  kind?: string;
  credentialType?: CredentialType;
  groupId?: string;
}

export interface CountsTagRow {
  accountId: string;
  groupId: string;
  name: string;
}

/** Write-back units of a rotation apply: the account patch and the re-encrypted history row. */
export interface CountsAccountRewrite {
  id: string;
  patch: CountsAccountPatch;
}

export interface CountsHistoryRewrite {
  id: string;
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Only layer that touches the counts tables. Metadata is plaintext (searchable
 * without unlock); secret columns are opaque to this layer.
 */
@Injectable()
export class CountsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  // ============ ACCOUNTS ============

  async create(data: typeof countsAccounts.$inferInsert): Promise<CountsAccountRow> {
    const inserted = await this.db.insert(countsAccounts).values(data).returning();
    return inserted[0];
  }

  async findActive(filters: CountsListFilters = {}): Promise<CountsAccountRow[]> {
    const conditions = [eq(countsAccounts.status, 'active')];

    if (filters.kind) {
      conditions.push(eq(countsAccounts.kind, filters.kind));
    }
    if (filters.credentialType) {
      conditions.push(eq(countsAccounts.credentialType, filters.credentialType));
    }
    if (filters.q) {
      const like = `%${filters.q}%`;
      const search = or(
        ilike(countsAccounts.name, like),
        ilike(countsAccounts.url, like),
        ilike(countsAccounts.username, like),
        ilike(countsAccounts.email, like),
        ilike(countsAccounts.notes, like),
      );
      if (search) conditions.push(search);
    }
    if (filters.groupId) {
      const accountIds = await this.accountIdsForGroup(filters.groupId);
      if (accountIds.length === 0) return [];
      conditions.push(inArray(countsAccounts.id, accountIds));
    }

    return this.db
      .select()
      .from(countsAccounts)
      .where(and(...conditions))
      .orderBy(desc(countsAccounts.updatedAt));
  }

  async findById(id: string): Promise<CountsAccountRow | undefined> {
    const rows = await this.db.select().from(countsAccounts).where(eq(countsAccounts.id, id)).limit(1);
    return rows[0];
  }

  /** Accounts carrying a stored password; OAuth-only rows have none, so they stay out. */
  async findWithStoredPassword(): Promise<CountsAccountRow[]> {
    return this.db
      .select()
      .from(countsAccounts)
      .where(and(eq(countsAccounts.status, 'active'), isNotNull(countsAccounts.passwordCiphertext)));
  }

  async findWeak(threshold: number): Promise<CountsAccountRow[]> {
    return this.db
      .select()
      .from(countsAccounts)
      .where(
        and(
          eq(countsAccounts.status, 'active'),
          isNotNull(countsAccounts.strengthScore),
          lte(countsAccounts.strengthScore, threshold.toFixed(1)),
        ),
      )
      .orderBy(asc(countsAccounts.strengthScore));
  }

  async update(id: string, data: CountsAccountPatch): Promise<CountsAccountRow | undefined> {
    const updated = await this.db
      .update(countsAccounts)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(countsAccounts.id, id), eq(countsAccounts.status, 'active')))
      .returning();
    return updated[0];
  }

  async softDelete(id: string): Promise<void> {
    await this.db.update(countsAccounts).set({ status: 'deleted' }).where(eq(countsAccounts.id, id));
  }

  // ============ PASSWORD HISTORY ============

  /** Moves the replaced password into history and applies the account patch atomically. */
  async rotatePassword(
    id: string,
    history: typeof countsPasswordHistory.$inferInsert,
    accountPatch: CountsAccountPatch,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(countsPasswordHistory).values(history);
      await tx
        .update(countsAccounts)
        .set({ ...accountPatch, updatedAt: new Date() })
        .where(and(eq(countsAccounts.id, id), eq(countsAccounts.status, 'active')));
    });
  }

  async findHistory(accountId: string): Promise<CountsHistoryRow[]> {
    return this.db
      .select()
      .from(countsPasswordHistory)
      .where(eq(countsPasswordHistory.accountId, accountId))
      .orderBy(desc(countsPasswordHistory.changedAt));
  }

  // ============ GROUPS (join table) ============

  /** Replaces the account's tags: full swap inside one transaction. */
  async replaceGroups(accountId: string, groupIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(countsAccountGroups).where(eq(countsAccountGroups.accountId, accountId));
      if (groupIds.length > 0) {
        await tx.insert(countsAccountGroups).values(groupIds.map((groupId) => ({ accountId, groupId })));
      }
    });
  }

  async findTags(accountIds: string[]): Promise<CountsTagRow[]> {
    if (accountIds.length === 0) return [];
    return this.db
      .select({
        accountId: countsAccountGroups.accountId,
        groupId: countsAccountGroups.groupId,
        name: groups.name,
      })
      .from(countsAccountGroups)
      .innerJoin(groups, eq(groups.id, countsAccountGroups.groupId))
      .where(and(inArray(countsAccountGroups.accountId, accountIds), eq(groups.status, 'active')));
  }

  // ============ ROTATION (spec 013) ============

  /** Every account, soft-deleted included: a stale ciphertext is a latent bug. */
  async findForRotation(): Promise<CountsAccountRow[]> {
    return this.db.select().from(countsAccounts);
  }

  /** Every history row: each one carries its own salt, so it is a write-back unit of its own. */
  async findHistoryForRotation(): Promise<CountsHistoryRow[]> {
    return this.db.select().from(countsPasswordHistory);
  }

  /**
   * Write-back of a rotation apply inside the transaction the caller commits with the new
   * canary. Salts are part of the key material and are not rotated, so only ciphertext columns
   * travel; `updated_at` is left alone because rotating a key is not an edit of the account.
   */
  async applyRotation(
    tx: DrizzleTx,
    accounts: CountsAccountRewrite[],
    history: CountsHistoryRewrite[],
  ): Promise<number> {
    let applied = 0;
    for (const account of accounts) {
      const updated = await tx
        .update(countsAccounts)
        .set(account.patch as never)
        .where(eq(countsAccounts.id, account.id))
        .returning({ id: countsAccounts.id });
      applied += updated.length;
    }
    for (const row of history) {
      const { id, ...data } = row;
      const updated = await tx
        .update(countsPasswordHistory)
        .set(data as never)
        .where(eq(countsPasswordHistory.id, id))
        .returning({ id: countsPasswordHistory.id });
      applied += updated.length;
    }
    return applied;
  }

  private async accountIdsForGroup(groupId: string): Promise<string[]> {
    const rows = await this.db
      .select({ accountId: countsAccountGroups.accountId })
      .from(countsAccountGroups)
      .where(eq(countsAccountGroups.groupId, groupId));
    return rows.map((r) => r.accountId);
  }
}