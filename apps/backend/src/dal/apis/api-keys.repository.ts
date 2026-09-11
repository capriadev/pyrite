import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb } from '../drizzle.provider';
import { apiKeys, apiGroups } from '../../../drizzle/schema';

export interface ApiKeyRow {
  id: string;
  provider: string;
  label: string;
  detail: string | null;
  groupId: string | null;
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
  status: string;
  validatorStatus: string;
  lastChecked: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ApiKeysRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async create(data: Partial<typeof apiKeys.$inferInsert>): Promise<ApiKeyRow> {
    const inserted = await this.db.insert(apiKeys).values(data as never).returning();
    return this.mapRow(inserted[0]);
  }

  async findActive(): Promise<ApiKeyRow[]> {
    const rows = await this.db.select().from(apiKeys).where(eq(apiKeys.status, 'active'));
    return rows.map((r) => this.mapRow(r));
  }

  async findById(id: string): Promise<ApiKeyRow | undefined> {
    const rows = await this.db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async softDelete(id: string): Promise<void> {
    await this.db.update(apiKeys).set({ status: 'deleted' }).where(eq(apiKeys.id, id));
  }

  async updateValidator(id: string, validatorStatus: string, lastChecked: Date): Promise<void> {
    await this.db.update(apiKeys).set({ validatorStatus: validatorStatus as never, lastChecked }).where(eq(apiKeys.id, id));
  }

  async updateLabel(id: string, label: string): Promise<void> {
    await this.db.update(apiKeys).set({ label }).where(eq(apiKeys.id, id));
  }

  async updateDetail(id: string, detail: string | null): Promise<void> {
    await this.db.update(apiKeys).set({ detail }).where(eq(apiKeys.id, id));
  }

  async updateGroup(id: string, groupId: string | null): Promise<void> {
    await this.db.update(apiKeys).set({ groupId: groupId ?? null }).where(eq(apiKeys.id, id));
  }

  // ============ GROUPS ============

  async createGroup(name: string): Promise<{ id: string; name: string; status: string }> {
    const inserted = await this.db.insert(apiGroups).values({ name }).returning();
    return { id: inserted[0].id, name: inserted[0].name, status: inserted[0].status };
  }

  async findGroups(): Promise<Array<{ id: string; name: string; status: string }>> {
    const rows = await this.db.select().from(apiGroups).where(eq(apiGroups.status, 'active'));
    return rows.map((r) => ({ id: r.id, name: r.name, status: r.status }));
  }

  async softDeleteGroup(id: string): Promise<void> {
    await this.db.update(apiGroups).set({ status: 'deleted' }).where(eq(apiGroups.id, id));
  }

  private mapRow(r: typeof apiKeys.$inferSelect): ApiKeyRow {
    return {
      id: r.id,
      provider: r.provider,
      label: r.label,
      detail: r.detail ?? null,
      groupId: r.groupId ?? null,
      ciphertext: r.ciphertext,
      iv: r.iv,
      authTag: r.authTag,
      salt: r.salt,
      status: r.status,
      validatorStatus: r.validatorStatus,
      lastChecked: r.lastChecked,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}