import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb } from '../drizzle.provider';
import { logPurgeRuns } from '../../../drizzle/schema';

export type LogPurgeRunRow = typeof logPurgeRuns.$inferSelect;
export type LogPurgeOrigin = LogPurgeRunRow['origin'];

/**
 * Only layer that touches the retention table (spec 023). The service decides what to purge; this
 * repository records the run and answers when the last one happened, which is what the interval
 * is measured against.
 */
@Injectable()
export class LogPurgeRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async record(data: Omit<typeof logPurgeRuns.$inferInsert, 'id'>): Promise<LogPurgeRunRow> {
    const inserted = await this.db.insert(logPurgeRuns).values(data).returning();
    return inserted[0];
  }

  /** Newest first: the history the panel will show. */
  async list(limit = 50): Promise<LogPurgeRunRow[]> {
    return this.db.select().from(logPurgeRuns).orderBy(desc(logPurgeRuns.startedAt)).limit(limit);
  }

  async lastRun(): Promise<LogPurgeRunRow | undefined> {
    const rows = await this.db.select().from(logPurgeRuns).orderBy(desc(logPurgeRuns.startedAt)).limit(1);
    return rows[0];
  }

  /** Last run of one origin: the boot pass measures its interval against the boot pass. */
  async lastRunOf(origin: LogPurgeOrigin): Promise<LogPurgeRunRow | undefined> {
    const rows = await this.db
      .select()
      .from(logPurgeRuns)
      .where(eq(logPurgeRuns.origin, origin))
      .orderBy(desc(logPurgeRuns.startedAt))
      .limit(1);
    return rows[0];
  }

  /** Totals for the metrics of the panel: runs, files and bytes freed since the beginning. */
  async totals(): Promise<{ runs: number; files: number; bytes: number; skipped: number }> {
    const rows = await this.db
      .select({
        runs: sql<number>`count(*)::int`,
        files: sql<number>`coalesce(sum(${logPurgeRuns.files}), 0)::int`,
        bytes: sql<string>`coalesce(sum(${logPurgeRuns.bytes}), 0)::text`,
        skipped: sql<number>`coalesce(sum(${logPurgeRuns.skipped}), 0)::int`,
      })
      .from(logPurgeRuns);
    const row = rows[0];
    return {
      runs: Number(row?.runs ?? 0),
      files: Number(row?.files ?? 0),
      bytes: Number(row?.bytes ?? 0),
      skipped: Number(row?.skipped ?? 0),
    };
  }
}
