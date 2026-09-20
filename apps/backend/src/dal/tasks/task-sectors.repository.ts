import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb } from '../drizzle.provider';
import { taskSectors } from '../../../drizzle/schema';

export type TaskSectorRow = typeof taskSectors.$inferSelect;

/**
 * Loose sectors of a task (spec 016). Small on purpose: the list, the lookup by name and
 * the on-the-fly creation the form needs when "otro" is picked, reusable from then on.
 * A sector is never deleted by the user in this version: it is a small catalogue.
 */
@Injectable()
export class TaskSectorsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async list(): Promise<TaskSectorRow[]> {
    return this.db
      .select()
      .from(taskSectors)
      .where(eq(taskSectors.status, 'active'))
      .orderBy(asc(taskSectors.name));
  }

  async findById(id: string): Promise<TaskSectorRow | undefined> {
    const rows = await this.db.select().from(taskSectors).where(eq(taskSectors.id, id)).limit(1);
    return rows[0];
  }

  /** Any status: a sector the user retired is revived instead of duplicated. */
  async findByName(name: string): Promise<TaskSectorRow | undefined> {
    const rows = await this.db.select().from(taskSectors).where(eq(taskSectors.name, name)).limit(1);
    return rows[0];
  }

  async create(name: string): Promise<TaskSectorRow> {
    const inserted = await this.db.insert(taskSectors).values({ name }).returning();
    return inserted[0];
  }

  async reactivate(id: string): Promise<TaskSectorRow> {
    const updated = await this.db
      .update(taskSectors)
      .set({ status: 'active' })
      .where(and(eq(taskSectors.id, id), eq(taskSectors.status, 'deleted')))
      .returning();
    return updated[0];
  }
}
