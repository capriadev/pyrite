import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb } from './drizzle.provider';
import { settings } from '../../../../drizzle/schema';

/**
 * Only layer that touches the settings table. No business logic here.
 */
@Injectable()
export class SettingsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findAll(): Promise<Array<{ key: string; value: unknown; updatedAt: Date }>> {
    return this.db.select().from(settings);
  }

  async findByKey(key: string): Promise<{ key: string; value: unknown; updatedAt: Date } | undefined> {
    const rows = await this.db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return rows[0];
  }

  async upsert(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
  }
}