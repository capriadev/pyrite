import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb, type DrizzleTx, withTransaction } from '../drizzle.provider';
import { rotationJobs, rotationStaging } from '../../../drizzle/schema';

export type RotationJobRow = typeof rotationJobs.$inferSelect;
export type RotationStagingRow = typeof rotationStaging.$inferSelect;
export type RotationStatus = RotationJobRow['status'];

/** A job in any of these states still holds the section (one open job per section). */
export const OPEN_ROTATION_STATUSES: RotationStatus[] = ['staging', 'applying', 'interrupted'];

/** One write-back unit: what the apply step copies into the live columns. */
export interface StagedWrite {
  targetTable: string;
  rowId: string;
  payload: Record<string, unknown>;
}

/**
 * Only layer that touches the rotation tables (spec 013). It holds the durable job
 * state and the staged ciphertexts; passphrases and keys never reach this layer.
 */
@Injectable()
export class RotationRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  // ============ JOBS ============

  async createJob(
    section: string,
    total: number,
    pendingCanary: Record<string, unknown>,
  ): Promise<RotationJobRow> {
    const inserted = await this.db
      .insert(rotationJobs)
      .values({ section, total, pendingCanary })
      .returning();
    return inserted[0];
  }

  async findOpenJob(section: string): Promise<RotationJobRow | undefined> {
    const rows = await this.db
      .select()
      .from(rotationJobs)
      .where(and(eq(rotationJobs.section, section), inArray(rotationJobs.status, OPEN_ROTATION_STATUSES)))
      .limit(1);
    return rows[0];
  }

  async findJob(jobId: string): Promise<RotationJobRow | undefined> {
    const rows = await this.db.select().from(rotationJobs).where(eq(rotationJobs.id, jobId)).limit(1);
    return rows[0];
  }

  async updateProgress(jobId: string, processed: number, total?: number): Promise<void> {
    await this.db
      .update(rotationJobs)
      .set({ processed, ...(total === undefined ? {} : { total }), updatedAt: new Date() })
      .where(eq(rotationJobs.id, jobId));
  }

  async markStatus(jobId: string, status: RotationStatus, error?: string): Promise<void> {
    await this.db
      .update(rotationJobs)
      .set({ status, error: error ?? null, updatedAt: new Date() })
      .where(eq(rotationJobs.id, jobId));
  }

  /** Startup recovery: a job the process left staging is surfaced as interrupted. */
  async markStagingAsInterrupted(): Promise<number> {
    const updated = await this.db
      .update(rotationJobs)
      .set({ status: 'interrupted', updatedAt: new Date() })
      .where(eq(rotationJobs.status, 'staging'))
      .returning({ id: rotationJobs.id });
    return updated.length;
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.db.delete(rotationJobs).where(eq(rotationJobs.id, jobId));
  }

  // ============ STAGING ============

  /** Incremental and idempotent: re-staging a unit overwrites its payload. */
  async stageRow(jobId: string, write: StagedWrite): Promise<void> {
    await this.db
      .insert(rotationStaging)
      .values({ jobId, targetTable: write.targetTable, rowId: write.rowId, payload: write.payload })
      .onConflictDoUpdate({
        target: [rotationStaging.jobId, rotationStaging.targetTable, rotationStaging.rowId],
        set: { payload: write.payload, stagedAt: new Date() },
      });
  }

  async countStaged(jobId: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(rotationStaging)
      .where(eq(rotationStaging.jobId, jobId));
    return Number(rows[0]?.value ?? 0);
  }

  async listStaged(jobId: string): Promise<RotationStagingRow[]> {
    return this.db.select().from(rotationStaging).where(eq(rotationStaging.jobId, jobId));
  }

  /** Rollback path: staged rows are disposable, dropping them loses nothing live. */
  async clearStaging(jobId: string): Promise<number> {
    const removed = await this.db
      .delete(rotationStaging)
      .where(eq(rotationStaging.jobId, jobId))
      .returning({ rowId: rotationStaging.rowId });
    return removed.length;
  }

  // ============ APPLY (one transaction) ============

  /**
   * Atomic swap: the staged rows, the new canary (written by `work`) and the job status
   * land together or not at all, so a blackout leaves the section fully old or fully new.
   * Staging is dropped in the same transaction.
   */
  async applyStaged(
    jobId: string,
    work: (tx: DrizzleTx, staged: RotationStagingRow[]) => Promise<number>,
  ): Promise<number> {
    const staged = await this.listStaged(jobId);
    return withTransaction(this.db, async (tx) => {
      const applied = await work(tx, staged);
      await tx
        .update(rotationJobs)
        .set({ status: 'done', error: null, processed: staged.length, updatedAt: new Date() })
        .where(eq(rotationJobs.id, jobId));
      await tx.delete(rotationStaging).where(eq(rotationStaging.jobId, jobId));
      return applied;
    });
  }
}