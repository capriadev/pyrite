import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb } from './drizzle.provider';
import { ratesDaily } from '../../drizzle/schema';

@Injectable()
export class RatesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async upsertMany(rows: Array<{ type: string; buy: number; sell: number; date: string }>): Promise<void> {
    for (const row of rows) {
      await this.db
        .insert(ratesDaily)
        .values({ type: row.type, buy: String(row.buy), sell: String(row.sell), date: row.date })
        .onConflictDoNothing({ target: [ratesDaily.type, ratesDaily.date], });
    }
  }

  async getLatest(type: string): Promise<{ buy: number; sell: number; date: string } | undefined> {
    const result = await this.db.execute(sql`SELECT buy, sell, date FROM rates_daily WHERE type = ${type} ORDER BY date DESC LIMIT 1`);
    const rows = result.rows as unknown as Array<{ buy: string; sell: string; date: string }>;
    if (rows.length === 0) return undefined;
    const r = rows[0];
    return { buy: Number(r.buy), sell: Number(r.sell), date: r.date };
  }

  async getSeries(type: string, from?: string, to?: string): Promise<Array<{ buy: number; sell: number; date: string }>> {
    const conditions = [eq(ratesDaily.type, type)];
    if (from) conditions.push(sql`${ratesDaily.date} >= ${from}`);
    if (to) conditions.push(sql`${ratesDaily.date} <= ${to}`);
    const rows = await this.db
      .select({ buy: ratesDaily.buy, sell: ratesDaily.sell, date: ratesDaily.date })
      .from(ratesDaily)
      .where(conditions.length > 1 ? sql`${sql.join(conditions, sql` AND `)}` : conditions[0])
      .orderBy(ratesDaily.date);
    return rows.map((r) => ({ buy: Number(r.buy), sell: Number(r.sell), date: r.date }));
  }

  async getLastDate(type: string): Promise<string | undefined> {
    const result = await this.db.execute(sql`SELECT date FROM rates_daily WHERE type = ${type} ORDER BY date DESC LIMIT 1`);
    const rows = result.rows as unknown as Array<{ date: string }>;
    return rows[0]?.date;
  }
}