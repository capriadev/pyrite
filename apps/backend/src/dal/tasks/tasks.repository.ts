import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb } from '../drizzle.provider';
import {
  taskExpectations,
  taskPayments,
  taskPriceTiers,
  taskRecurrence,
  tasks,
} from '../../../drizzle/schema';

/**
 * Row types derive from the schema instead of hand-written mappers, the same
 * rule as the other repositories: the table already declares nullability and enums.
 */
export type TaskRow = typeof tasks.$inferSelect;
export type TaskRecurrenceRow = typeof taskRecurrence.$inferSelect;
export type TaskPriceTierRow = typeof taskPriceTiers.$inferSelect;
export type TaskPaymentRow = typeof taskPayments.$inferSelect;
export type TaskExpectationRow = typeof taskExpectations.$inferSelect;

export type TaskType = TaskRow['type'];
export type TaskStatus = TaskRow['status'];
export type Currency = TaskPriceTierRow['currency'];

/** A task with its rule, tiers and payment payload: exactly what the engine consumes. */
export interface TaskAggregate {
  task: TaskRow;
  recurrence: TaskRecurrenceRow | null;
  tiers: TaskPriceTierRow[];
  payment: TaskPaymentRow | null;
}

export interface TaskListFilters {
  type?: TaskType;
  status?: TaskStatus;
  from?: string;
  to?: string;
}

/**
 * One materialized occurrence to write. Insert-or-ignore on (task, date) is what
 * makes a second materialization pass idempotent.
 */
export interface ExpectationInsert {
  taskId: string;
  expectedOn: string;
  estimatedAmount: string | null;
  currency: Currency | null;
  tierPosition: number | null;
}

/** Column patch of a task, derived from the schema so it cannot drift. */
export type TaskPatch = Partial<typeof tasks.$inferInsert>;

/**
 * Only layer that touches the calendar/tasks tables. Dates, titles and estimates
 * are plaintext by design: this domain holds no secrets (spec 015).
 */
@Injectable()
export class TasksRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  // ============ TASKS ============

  async create(data: typeof tasks.$inferInsert): Promise<TaskRow> {
    const inserted = await this.db.insert(tasks).values(data).returning();
    return inserted[0];
  }

  async update(id: string, patch: Partial<typeof tasks.$inferInsert>): Promise<TaskRow | undefined> {
    const updated = await this.db
      .update(tasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    return updated[0];
  }

  async findById(id: string): Promise<TaskRow | undefined> {
    const rows = await this.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return rows[0];
  }

  /** Reads exclude soft-deleted rows unless the caller asks for them by status. */
  async list(filters: TaskListFilters = {}): Promise<TaskRow[]> {
    const conditions = [eq(tasks.status, filters.status ?? 'active')];
    if (filters.type) conditions.push(eq(tasks.type, filters.type));
    if (filters.from) conditions.push(gte(tasks.startsOn, filters.from));
    if (filters.to) conditions.push(lte(tasks.startsOn, filters.to));
    return this.db.select().from(tasks).where(and(...conditions)).orderBy(asc(tasks.startsOn));
  }

  async listByIds(ids: string[]): Promise<TaskRow[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(tasks).where(inArray(tasks.id, ids));
  }

  // ============ RULE, TIERS AND PAYMENT PAYLOAD ============

  /** One rule per task: an upsert, so an edit never leaves a stale rule behind. */
  async saveRecurrence(taskId: string, data: Omit<typeof taskRecurrence.$inferInsert, 'taskId'>): Promise<void> {
    await this.db
      .insert(taskRecurrence)
      .values({ taskId, ...data })
      .onConflictDoUpdate({ target: taskRecurrence.taskId, set: data });
  }

  async deleteRecurrence(taskId: string): Promise<void> {
    await this.db.delete(taskRecurrence).where(eq(taskRecurrence.taskId, taskId));
  }

  async savePayment(taskId: string, data: Omit<typeof taskPayments.$inferInsert, 'taskId'>): Promise<void> {
    await this.db
      .insert(taskPayments)
      .values({ taskId, ...data })
      .onConflictDoUpdate({ target: taskPayments.taskId, set: data });
  }

  async deletePayment(taskId: string): Promise<void> {
    await this.db.delete(taskPayments).where(eq(taskPayments.taskId, taskId));
  }

  /** Full swap of the tiers in one transaction: an edit replaces the sequence. */
  async replaceTiers(taskId: string, rows: Array<Omit<typeof taskPriceTiers.$inferInsert, 'taskId'>>): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(taskPriceTiers).where(eq(taskPriceTiers.taskId, taskId));
      if (rows.length > 0) {
        await tx.insert(taskPriceTiers).values(rows.map((row) => ({ taskId, ...row })));
      }
    });
  }

  async findRecurrence(taskId: string): Promise<TaskRecurrenceRow | undefined> {
    const rows = await this.db.select().from(taskRecurrence).where(eq(taskRecurrence.taskId, taskId)).limit(1);
    return rows[0];
  }

  async findPayment(taskId: string): Promise<TaskPaymentRow | undefined> {
    const rows = await this.db.select().from(taskPayments).where(eq(taskPayments.taskId, taskId)).limit(1);
    return rows[0];
  }

  async findTiers(taskId: string): Promise<TaskPriceTierRow[]> {
    return this.db
      .select()
      .from(taskPriceTiers)
      .where(eq(taskPriceTiers.taskId, taskId))
      .orderBy(asc(taskPriceTiers.position));
  }

  /** The task plus everything the engine needs, resolved in one place. */
  async findAggregate(id: string): Promise<TaskAggregate | null> {
    const task = await this.findById(id);
    if (!task) return null;
    const [recurrence, payment, tiers] = await Promise.all([
      this.findRecurrence(id),
      this.findPayment(id),
      this.findTiers(id),
    ]);
    return { task, recurrence: recurrence ?? null, payment: payment ?? null, tiers };
  }

  /** Tasks with their rules: the input of a list view or a materialization pass. */
  async listAggregates(filters: TaskListFilters = {}): Promise<TaskAggregate[]> {
    const rows = await this.list(filters);
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [recurrences, payments, tiers] = await Promise.all([
      this.db.select().from(taskRecurrence).where(inArray(taskRecurrence.taskId, ids)),
      this.db.select().from(taskPayments).where(inArray(taskPayments.taskId, ids)),
      this.db
        .select()
        .from(taskPriceTiers)
        .where(inArray(taskPriceTiers.taskId, ids))
        .orderBy(asc(taskPriceTiers.position)),
    ]);
    const recurrenceByTask = new Map(recurrences.map((row) => [row.taskId, row]));
    const paymentByTask = new Map(payments.map((row) => [row.taskId, row]));
    const tiersByTask = new Map<string, TaskPriceTierRow[]>();
    for (const tier of tiers) {
      tiersByTask.set(tier.taskId, [...(tiersByTask.get(tier.taskId) ?? []), tier]);
    }
    return rows.map((task) => ({
      task,
      recurrence: recurrenceByTask.get(task.id) ?? null,
      payment: paymentByTask.get(task.id) ?? null,
      tiers: tiersByTask.get(task.id) ?? [],
    }));
  }

  // ============ EXPECTATIONS ============

  /** Idempotent on (task, date): a second pass inserts nothing. */
  async insertExpectations(rows: ExpectationInsert[]): Promise<number> {
    if (rows.length === 0) return 0;
    const inserted = await this.db
      .insert(taskExpectations)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: taskExpectations.id });
    return inserted.length;
  }

  /** Only the future is rebuilt on an edit: what already happened stays recorded. */
  async deleteExpectationsFrom(taskId: string, from: string): Promise<void> {
    await this.db
      .delete(taskExpectations)
      .where(and(eq(taskExpectations.taskId, taskId), gte(taskExpectations.expectedOn, from)));
  }

  async listExpectations(taskId: string): Promise<TaskExpectationRow[]> {
    return this.db
      .select()
      .from(taskExpectations)
      .where(eq(taskExpectations.taskId, taskId))
      .orderBy(asc(taskExpectations.expectedOn));
  }

  async listExpectationsInRange(from: string, to: string): Promise<TaskExpectationRow[]> {
    return this.db
      .select()
      .from(taskExpectations)
      .where(and(gte(taskExpectations.expectedOn, from), lte(taskExpectations.expectedOn, to)))
      .orderBy(asc(taskExpectations.expectedOn));
  }
}
