import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb } from '../drizzle.provider';
import { movements, categories, platforms, balances } from '../../../drizzle/schema';

/**
 * DAL for the finances domain. Only layer that touches these tables.
 * The BLL computes balance logic; this repository just persists/reads rows.
 */
@Injectable()
export class FinancesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  // ======== movements ========

  async createMovement(row: typeof movements.$inferInsert): Promise<typeof movements.$inferSelect> {
    const inserted = await this.db.insert(movements).values(row).returning();
    return inserted[0];
  }

  async findMovements(): Promise<Array<typeof movements.$inferSelect>> {
    return this.db.select().from(movements).where(eq(movements.status, 'active')).orderBy(movements.date);
  }

  async findMovement(id: string): Promise<typeof movements.$inferSelect | undefined> {
    const rows = await this.db.select().from(movements).where(eq(movements.id, id)).limit(1);
    return rows[0];
  }

  async softDeleteMovement(id: string): Promise<void> {
    await this.db.update(movements).set({ status: 'deleted' }).where(eq(movements.id, id));
  }

  // ======== categories ========

  async createCategory(name: string, type: 'income' | 'expense'): Promise<typeof categories.$inferSelect> {
    const inserted = await this.db.insert(categories).values({ name, type }).returning();
    return inserted[0];
  }

  async findCategories(): Promise<Array<typeof categories.$inferSelect>> {
    return this.db.select().from(categories).where(eq(categories.status, 'active'));
  }

  // ======== platforms ========

  async createPlatform(name: string): Promise<typeof platforms.$inferSelect> {
    const inserted = await this.db.insert(platforms).values({ name }).returning();
    return inserted[0];
  }

  async findPlatforms(): Promise<Array<typeof platforms.$inferSelect>> {
    return this.db.select().from(platforms).where(eq(platforms.status, 'active'));
  }

  // ======== balances ========

  async getBalance(key: string): Promise<number> {
    const rows = await this.db.select().from(balances).where(eq(balances.key, key as never)).limit(1);
    return rows.length ? Number(rows[0].amount) : 0;
  }

  async setBalance(key: string, amount: number): Promise<void> {
    await this.db
      .insert(balances)
      .values({ key: key as never, amount: String(amount) })
      .onConflictDoUpdate({ target: balances.key, set: { amount: String(amount) } });
  }
}