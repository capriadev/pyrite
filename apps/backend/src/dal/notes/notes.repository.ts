import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb, type DrizzleTx } from '../drizzle.provider';
import { notes } from '../../../drizzle/schema';

export interface NoteRow {
  id: string;
  title: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
  isPrivate: string;
  pinned: string;
  groupId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
}

/** Columns a rotation apply writes back: the ciphertext and the copy of the new section key. */
export interface NoteRewrite {
  id: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
}

@Injectable()
export class NotesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async create(data: Partial<typeof notes.$inferInsert>): Promise<NoteRow> {
    const inserted = await this.db.insert(notes).values(data as never).returning();
    return this.mapRow(inserted[0]);
  }

  async findActive(): Promise<NoteRow[]> {
    const rows = await this.db
      .select()
      .from(notes)
      .where(eq(notes.status, 'active'))
      .orderBy(desc(notes.updatedAt));
    return rows.map((r) => this.mapRow(r));
  }

  async findById(id: string): Promise<NoteRow | undefined> {
    const rows = await this.db.select().from(notes).where(eq(notes.id, id)).limit(1);
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async update(id: string, data: Partial<typeof notes.$inferInsert>): Promise<NoteRow | undefined> {
    const updated = await this.db
      .update(notes)
      .set({ ...data, updatedAt: new Date() } as never)
      .where(and(eq(notes.id, id), eq(notes.status, 'active')))
      .returning();
    return updated[0] ? this.mapRow(updated[0]) : undefined;
  }

  async softDelete(id: string): Promise<void> {
    await this.db.update(notes).set({ status: 'deleted' }).where(eq(notes.id, id));
  }

  async touchAccessed(id: string): Promise<void> {
    await this.db.update(notes).set({ lastAccessedAt: new Date() }).where(eq(notes.id, id));
  }

  /** Every row of a section, soft-deleted included: a stale ciphertext is a latent bug. */
  async findForRotation(isPrivate: boolean): Promise<NoteRow[]> {
    const rows = await this.db
      .select()
      .from(notes)
      .where(eq(notes.isPrivate, isPrivate ? 'true' : 'false'));
    return rows.map((r) => this.mapRow(r));
  }

  /**
   * Write-back of a rotation apply: only the ciphertext columns, inside the transaction the
   * caller commits with the new canary. `updated_at` is left alone on purpose - rotating a
   * key is not an edit of the note.
   */
  async applyRotation(tx: DrizzleTx, rows: NoteRewrite[]): Promise<number> {
    let applied = 0;
    for (const row of rows) {
      const { id, ...data } = row;
      const updated = await tx
        .update(notes)
        .set(data as never)
        .where(eq(notes.id, id))
        .returning({ id: notes.id });
      applied += updated.length;
    }
    return applied;
  }

  private mapRow(r: typeof notes.$inferSelect): NoteRow {
    return {
      id: r.id,
      title: r.title,
      ciphertext: r.ciphertext,
      iv: r.iv,
      authTag: r.authTag,
      salt: r.salt,
      isPrivate: r.isPrivate,
      pinned: r.pinned,
      groupId: r.groupId,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      lastAccessedAt: r.lastAccessedAt,
    };
  }
}