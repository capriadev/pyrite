import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb } from '../drizzle.provider';
import { groups } from '../../../drizzle/schema';

export type GroupDomain = 'apis' | 'notes' | 'counts' | 'tasks';

export interface GroupRow {
  id: string;
  domain: GroupDomain;
  parentId: string | null;
  name: string;
  status: string;
  createdAt: Date;
}

/** Read shape of the tree endpoint: a node with its children already resolved. */
export interface GroupNode extends GroupRow {
  children: GroupNode[];
}

/**
 * Groups are a per-domain tree (spec 016): roots have `parent_id` null and any node can
 * hold children, so folders of any depth are the same mechanism. Only this layer touches
 * the table, and the hierarchy is walked in SQL only where it pays (the CTE queries).
 */
@Injectable()
export class GroupsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async create(domain: GroupDomain, name: string, parentId: string | null = null): Promise<GroupRow> {
    const inserted = await this.db
      .insert(groups)
      .values({ domain, name, parentId })
      .returning();
    return this.mapRow(inserted[0]);
  }

  async findById(domain: GroupDomain, id: string): Promise<GroupRow | undefined> {
    const rows = await this.db
      .select()
      .from(groups)
      .where(and(eq(groups.id, id), eq(groups.domain, domain)))
      .limit(1);
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  /** Uniqueness is per level: the same name may exist under different parents. */
  async findByName(domain: GroupDomain, name: string, parentId: string | null = null): Promise<GroupRow | undefined> {
    const rows = await this.db
      .select()
      .from(groups)
      .where(
        and(
          eq(groups.domain, domain),
          eq(groups.name, name),
          eq(groups.status, 'active'),
          this.parentMatch(parentId),
        ),
      )
      .limit(1);
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async findAll(domain: GroupDomain): Promise<GroupRow[]> {
    const rows = await this.db
      .select()
      .from(groups)
      .where(and(eq(groups.domain, domain), eq(groups.status, 'active')))
      .orderBy(asc(groups.name));
    return rows.map((r) => this.mapRow(r));
  }

  async rename(domain: GroupDomain, id: string, name: string): Promise<void> {
    await this.db.update(groups).set({ name }).where(and(eq(groups.id, id), eq(groups.domain, domain)));
  }

  async move(domain: GroupDomain, id: string, parentId: string | null): Promise<void> {
    await this.db.update(groups).set({ parentId }).where(and(eq(groups.id, id), eq(groups.domain, domain)));
  }

  async softDelete(domain: GroupDomain, id: string): Promise<void> {
    await this.db
      .update(groups)
      .set({ status: 'deleted' })
      .where(and(eq(groups.id, id), eq(groups.domain, domain)));
  }

  /** The node plus its ancestors: enough to reject a move that would close a cycle. */
  async ancestorsAndSelf(domain: GroupDomain, id: string): Promise<string[]> {
    const result = await this.db.execute(sql`
      with recursive up as (
        select id, parent_id from groups where id = ${id} and domain = ${domain}
        union all
        select g.id, g.parent_id from groups g join up on g.id = up.parent_id
      )
      select id from up
    `);
    return (result.rows as Array<{ id: string }>).map((row) => row.id);
  }

  /** Subtree of a node, the node included: what a branch filter resolves to. */
  async subtreeIds(domain: GroupDomain, id: string): Promise<string[]> {
    const result = await this.db.execute(sql`
      with recursive down as (
        select id from groups where id = ${id} and domain = ${domain} and status = 'active'
        union all
        select g.id from groups g join down on g.parent_id = down.id where g.status = 'active'
      )
      select id from down
    `);
    return (result.rows as Array<{ id: string }>).map((row) => row.id);
  }

  private parentMatch(parentId: string | null) {
    return parentId === null ? isNull(groups.parentId) : eq(groups.parentId, parentId);
  }

  private mapRow(r: typeof groups.$inferSelect): GroupRow {
    return {
      id: r.id,
      domain: r.domain as GroupDomain,
      parentId: r.parentId,
      name: r.name,
      status: r.status,
      createdAt: r.createdAt,
    };
  }
}
