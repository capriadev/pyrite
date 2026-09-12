import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb } from '../drizzle.provider';
import { groups } from '../../../drizzle/schema';

export type GroupDomain = 'apis' | 'notes';

export interface GroupRow {
  id: string;
  domain: GroupDomain;
  name: string;
  status: string;
  createdAt: Date;
}

@Injectable()
export class GroupsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async create(domain: GroupDomain, name: string): Promise<GroupRow> {
    const inserted = await this.db
      .insert(groups)
      .values({ domain, name })
      .returning();
    return this.mapRow(inserted[0]);
  }

  async findByName(domain: GroupDomain, name: string): Promise<GroupRow | undefined> {
    const rows = await this.db
      .select()
      .from(groups)
      .where(and(eq(groups.domain, domain), eq(groups.name, name), eq(groups.status, 'active')))
      .limit(1);
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async findAll(domain: GroupDomain): Promise<GroupRow[]> {
    const rows = await this.db
      .select()
      .from(groups)
      .where(and(eq(groups.domain, domain), eq(groups.status, 'active')));
    return rows.map((r) => this.mapRow(r));
  }

  async softDelete(domain: GroupDomain, id: string): Promise<void> {
    await this.db
      .update(groups)
      .set({ status: 'deleted' })
      .where(and(eq(groups.id, id), eq(groups.domain, domain)));
  }

  private mapRow(r: typeof groups.$inferSelect): GroupRow {
    return {
      id: r.id,
      domain: r.domain as GroupDomain,
      name: r.name,
      status: r.status,
      createdAt: r.createdAt,
    };
  }
}
