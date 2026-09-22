import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb } from '../drizzle.provider';
import {
  categories,
  disputeCandidates,
  disputes,
  movements,
  reconciliationLinks,
  taskCategoryLinks,
  taskExpectations,
  taskMatchHistory,
  taskSectors,
  tasks,
} from '../../../drizzle/schema';

export type DisputeRow = typeof disputes.$inferSelect;
export type DisputeCandidateRow = typeof disputeCandidates.$inferSelect;
export type ReconciliationLinkRow = typeof reconciliationLinks.$inferSelect;
export type TaskCategoryLinkRow = typeof taskCategoryLinks.$inferSelect;
export type MovementRow = typeof movements.$inferSelect;
export type ExpectationRow = typeof taskExpectations.$inferSelect;

export type DisputeType = DisputeRow['type'];
export type DisputeResolution = NonNullable<DisputeRow['resolution']>;

export interface DisputeListFilters {
  type?: DisputeType;
  status?: DisputeRow['status'];
}

/** A pending payment expectation with the metadata of its task: the input of one matcher pass. */
export interface PendingExpectation extends ExpectationRow {
  taskTitle: string;
  taskDescription: string | null;
  taskNotes: string | null;
  taskSectorName: string | null;
}

/**
 * Only layer that touches the dispute tables. The matcher decides; this repository reads and
 * writes, and keeps the writes of a link atomic with the status of its expectation.
 */
@Injectable()
export class DisputesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  // ============ DECLARED CATEGORY LINKS ============

  async listCategoryLinks(taskId: string): Promise<TaskCategoryLinkRow[]> {
    return this.db.select().from(taskCategoryLinks).where(eq(taskCategoryLinks.taskId, taskId));
  }

  /** Full swap in one transaction: the declaration of a task is replaced, not patched. */
  async replaceCategoryLinks(taskId: string, categoryIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(taskCategoryLinks).where(eq(taskCategoryLinks.taskId, taskId));
      if (categoryIds.length > 0) {
        await tx.insert(taskCategoryLinks).values(categoryIds.map((categoryId) => ({ taskId, categoryId })));
      }
    });
  }

  /** Every declaration of the system: what a matcher pass loads once. */
  async listAllCategoryLinks(): Promise<TaskCategoryLinkRow[]> {
    return this.db.select().from(taskCategoryLinks);
  }

  async findCategoryIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.id, ids));
    return rows.map((row) => row.id);
  }

  // ============ EXPECTATIONS AND MOVEMENTS ============

  /**
   * Pending payment expectations due on or before `until`, with the metadata of their task:
   * title, description, notes and sector are what the scorer reads. Tasks that are not active
   * are excluded: a paused or deleted payment stops expecting money.
   */
  async listPendingPaymentExpectations(until: string): Promise<PendingExpectation[]> {
    const rows = await this.db
      .select({
        expectation: taskExpectations,
        title: tasks.title,
        description: tasks.description,
        notes: tasks.notes,
        sectorName: taskSectors.name,
      })
      .from(taskExpectations)
      .innerJoin(tasks, eq(tasks.id, taskExpectations.taskId))
      .leftJoin(taskSectors, eq(taskSectors.id, tasks.sectorId))
      .where(
        and(
          eq(taskExpectations.status, 'pending'),
          lte(taskExpectations.expectedOn, until),
          eq(tasks.type, 'pago'),
          eq(tasks.status, 'active'),
        ),
      )
      .orderBy(asc(taskExpectations.expectedOn));
    return rows.map((row) => ({
      ...row.expectation,
      taskTitle: row.title,
      taskDescription: row.description,
      taskNotes: row.notes,
      taskSectorName: row.sectorName,
    }));
  }

  /** Every pending payment expectation of a task, whatever its date: the aging works on them. */
  async listConstrainedExpectations(status: ExpectationRow['status']): Promise<ExpectationRow[]> {
    return this.db.select().from(taskExpectations).where(eq(taskExpectations.status, status));
  }

  async findExpectation(id: string): Promise<ExpectationRow | undefined> {
    const rows = await this.db.select().from(taskExpectations).where(eq(taskExpectations.id, id)).limit(1);
    return rows[0];
  }

  /** Active movements of the given categories inside the window, oldest first. */
  async listMovementsInWindow(categoryIds: string[], from: string, to: string): Promise<MovementRow[]> {
    if (categoryIds.length === 0) return [];
    return this.db
      .select()
      .from(movements)
      .where(
        and(
          eq(movements.status, 'active'),
          inArray(movements.categoryId, categoryIds),
          gte(movements.date, new Date(`${from}T00:00:00.000Z`)),
          lte(movements.date, new Date(`${to}T23:59:59.999Z`)),
        ),
      )
      .orderBy(asc(movements.date));
  }

  async listMovementsOfCategories(categoryIds: string[]): Promise<MovementRow[]> {
    if (categoryIds.length === 0) return [];
    return this.db
      .select()
      .from(movements)
      .where(and(eq(movements.status, 'active'), inArray(movements.categoryId, categoryIds)))
      .orderBy(asc(movements.date));
  }

  async findMovement(id: string): Promise<MovementRow | undefined> {
    const rows = await this.db.select().from(movements).where(eq(movements.id, id)).limit(1);
    return rows[0];
  }

  async updateExpectationStatus(id: string, status: ExpectationRow['status']): Promise<void> {
    await this.db.update(taskExpectations).set({ status }).where(eq(taskExpectations.id, id));
  }

  /** Cancels what has not happened yet: the resolutions that drop a service use it. */
  async cancelFutureExpectations(taskId: string, from: string): Promise<number> {
    const rows = await this.db
      .update(taskExpectations)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(taskExpectations.taskId, taskId),
          gte(taskExpectations.expectedOn, from),
          eq(taskExpectations.status, 'pending'),
        ),
      )
      .returning({ id: taskExpectations.id });
    return rows.length;
  }

  // ============ LINKS ============

  async findLinkByExpectation(expectationId: string): Promise<ReconciliationLinkRow | undefined> {
    const rows = await this.db
      .select()
      .from(reconciliationLinks)
      .where(eq(reconciliationLinks.expectationId, expectationId))
      .limit(1);
    return rows[0];
  }

  async findLinkByMovement(movementId: string): Promise<ReconciliationLinkRow | undefined> {
    const rows = await this.db
      .select()
      .from(reconciliationLinks)
      .where(eq(reconciliationLinks.movementId, movementId))
      .limit(1);
    return rows[0];
  }

  /** Ids of every consumed movement: the first filter of a matcher pass. */
  async listLinkedMovementIds(): Promise<string[]> {
    const rows = await this.db.select({ movementId: reconciliationLinks.movementId }).from(reconciliationLinks);
    return rows.map((row) => row.movementId);
  }

  async listLinks(): Promise<ReconciliationLinkRow[]> {
    return this.db.select().from(reconciliationLinks).orderBy(desc(reconciliationLinks.createdAt));
  }

  /** Link plus status in one transaction: a settled expectation never lacks its link. */
  async createLink(
    expectationId: string,
    movementId: string,
    matchedBy: ReconciliationLinkRow['matchedBy'],
    amountDeviation: string | null,
    reviewNote: string | null,
  ): Promise<ReconciliationLinkRow> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(reconciliationLinks)
        .values({ expectationId, movementId, matchedBy, amountDeviation, reviewNote })
        .returning();
      await tx.update(taskExpectations).set({ status: 'settled' }).where(eq(taskExpectations.id, expectationId));
      return inserted[0];
    });
  }

  /** Frees the movement again and returns its expectation to waiting. */
  async deleteLinkByExpectation(expectationId: string): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(reconciliationLinks)
        .where(eq(reconciliationLinks.expectationId, expectationId))
        .returning({ movementId: reconciliationLinks.movementId });
      if (removed.length > 0) {
        await tx.update(taskExpectations).set({ status: 'pending' }).where(eq(taskExpectations.id, expectationId));
      }
      return removed[0]?.movementId ?? null;
    });
  }

  async deleteAutomaticLinks(): Promise<number> {
    const rows = await this.db
      .delete(reconciliationLinks)
      .where(eq(reconciliationLinks.matchedBy, 'declared'))
      .returning({ id: reconciliationLinks.id });
    return rows.length;
  }

  // ============ CANDIDATES ============

  async listCandidates(expectationId: string): Promise<DisputeCandidateRow[]> {
    return this.db
      .select()
      .from(disputeCandidates)
      .where(eq(disputeCandidates.expectationId, expectationId))
      .orderBy(asc(disputeCandidates.createdAt));
  }

  async insertCandidates(rows: Array<{ expectationId: string; movementId: string; reason: string }>): Promise<void> {
    if (rows.length === 0) return;
    await this.db.insert(disputeCandidates).values(rows).onConflictDoNothing();
  }

  /** Full swap of a consultation: the ranked candidates replace whatever was there. */
  async replaceCandidates(
    expectationId: string,
    rows: Array<{
      movementId: string;
      reason: string;
      score: number | null;
      rank: number | null;
      signals: Record<string, unknown> | null;
    }>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(disputeCandidates).where(eq(disputeCandidates.expectationId, expectationId));
      if (rows.length > 0) {
        await tx.insert(disputeCandidates).values(rows.map((row) => ({ expectationId, ...row })));
      }
    });
  }

  /** When a consultation was first raised: the clock of its aging. */
  async oldestCandidateAt(expectationId: string): Promise<Date | null> {
    const rows = await this.db
      .select({ createdAt: disputeCandidates.createdAt })
      .from(disputeCandidates)
      .where(eq(disputeCandidates.expectationId, expectationId))
      .orderBy(asc(disputeCandidates.createdAt))
      .limit(1);
    return rows[0]?.createdAt ?? null;
  }

  // ============ LEARNED HISTORY ============

  async listMatchHistory(taskIds: string[]): Promise<Array<typeof taskMatchHistory.$inferSelect>> {
    if (taskIds.length === 0) return [];
    return this.db.select().from(taskMatchHistory).where(inArray(taskMatchHistory.taskId, taskIds));
  }

  async findMatchHistory(taskId: string): Promise<typeof taskMatchHistory.$inferSelect | undefined> {
    const rows = await this.db.select().from(taskMatchHistory).where(eq(taskMatchHistory.taskId, taskId)).limit(1);
    return rows[0];
  }

  /**
   * One more confirmed link for that task id. `weight` is 2 for a human answer, because a
   * person deciding is the strongest signal available, and 1 for an automatic link.
   */
  async recordMatch(
    taskId: string,
    delayDays: number,
    amount: number,
    weight: number,
  ): Promise<typeof taskMatchHistory.$inferSelect> {
    const current = await this.findMatchHistory(taskId);
    const samples = (current?.sampleCount ?? 0) + weight;
    const previousTotal = Number(current?.averageDelayDays ?? 0) * (current?.sampleCount ?? 0);
    const average = (previousTotal + delayDays * weight) / samples;
    const lastAmounts = [...(current?.lastAmounts ?? []), amount].slice(-5);
    const values = {
      taskId,
      averageDelayDays: average.toFixed(2),
      sampleCount: samples,
      lastAmounts,
      lastMatchedAt: new Date(),
      updatedAt: new Date(),
    };
    const saved = await this.db
      .insert(taskMatchHistory)
      .values(values)
      .onConflictDoUpdate({ target: taskMatchHistory.taskId, set: values })
      .returning();
    return saved[0];
  }

  async deleteCandidatesForExpectation(expectationId: string): Promise<void> {
    await this.db.delete(disputeCandidates).where(eq(disputeCandidates.expectationId, expectationId));
  }

  // ============ DISPUTES ============

  async list(filters: DisputeListFilters = {}): Promise<DisputeRow[]> {
    const conditions = [];
    if (filters.type) conditions.push(eq(disputes.type, filters.type));
    if (filters.status) conditions.push(eq(disputes.status, filters.status));
    const rows = conditions.length > 0
      ? await this.db.select().from(disputes).where(and(...conditions))
      : await this.db.select().from(disputes);
    return rows.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
  }

  async findById(id: string): Promise<DisputeRow | undefined> {
    const rows = await this.db.select().from(disputes).where(eq(disputes.id, id)).limit(1);
    return rows[0];
  }

  /** An open dispute of the same shape is not duplicated: the matcher is idempotent by this. */
  async findOpenByExpectation(expectationId: string): Promise<DisputeRow | undefined> {
    const rows = await this.db
      .select()
      .from(disputes)
      .where(and(eq(disputes.expectationId, expectationId), eq(disputes.status, 'open')))
      .limit(1);
    return rows[0];
  }

  async findOpenByMovement(movementId: string): Promise<DisputeRow | undefined> {
    const rows = await this.db
      .select()
      .from(disputes)
      .where(and(eq(disputes.movementId, movementId), eq(disputes.status, 'open')))
      .limit(1);
    return rows[0];
  }

  /** The expectation is flipped in the same transaction as the dispute that reports it. */
  async openDispute(
    data: Omit<typeof disputes.$inferInsert, 'id'>,
    expectationStatus: ExpectationRow['status'] | null,
  ): Promise<DisputeRow> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx.insert(disputes).values(data).returning();
      if (expectationStatus && data.expectationId) {
        await tx
          .update(taskExpectations)
          .set({ status: expectationStatus })
          .where(eq(taskExpectations.id, data.expectationId));
      }
      return inserted[0];
    });
  }

  async resolve(
    id: string,
    resolution: DisputeResolution,
    note: string | null,
    expectationStatus: ExpectationRow['status'] | null,
  ): Promise<DisputeRow | undefined> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(disputes)
        .set({ status: 'resolved', resolution, resolutionNote: note, resolvedAt: new Date() })
        .where(eq(disputes.id, id))
        .returning();
      const updated = rows[0];
      if (expectationStatus && updated?.expectationId) {
        await tx
          .update(taskExpectations)
          .set({ status: expectationStatus })
          .where(eq(taskExpectations.id, updated.expectationId));
      }
      return updated;
    });
  }

  /** Open disputes are the engine's own work; resolved ones carry a human decision and stay. */
  async deleteOpenDisputes(): Promise<number> {
    const rows = await this.db
      .delete(disputes)
      .where(eq(disputes.status, 'open'))
      .returning({ id: disputes.id });
    return rows.length;
  }

  /** Consultations that rebuild discards: their expectations go back to waiting. */
  async resetSuggestions(): Promise<number> {
    const rows = await this.db
      .update(taskExpectations)
      .set({ status: 'pending' })
      .where(eq(taskExpectations.status, 'suggestion'))
      .returning({ id: taskExpectations.id });
    return rows.length;
  }

  /** Every expectation of the given tasks: the windows an unplanned movement is measured against. */
  async listExpectationsByTaskIds(taskIds: string[]): Promise<ExpectationRow[]> {
    if (taskIds.length === 0) return [];
    return this.db.select().from(taskExpectations).where(inArray(taskExpectations.taskId, taskIds));
  }

  async findTask(id: string): Promise<typeof tasks.$inferSelect | undefined> {
    const rows = await this.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return rows[0];
  }

  /** Dropping a service is a task state, not a deletion: the record of what happened stays. */
  async updateTaskStatus(id: string, status: typeof tasks.$inferSelect['status']): Promise<void> {
    await this.db.update(tasks).set({ status, updatedAt: new Date() }).where(eq(tasks.id, id));
  }
}
