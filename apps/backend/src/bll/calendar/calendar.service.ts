import { BadRequestException, Injectable } from '@nestjs/common';
import { TasksRepository, type TaskExpectationRow, type TaskRow } from '../../dal/tasks/tasks.repository';
import { isIsoDay } from '../../types/guards';

/** One thing the calendar renders on a day: an expectation of any task type. */
export interface CalendarEntry {
  taskId: string;
  expectationId: string | null;
  title: string;
  icon: string | null;
  type: TaskRow['type'];
  taskStatus: TaskRow['status'];
  amount: string | null;
  currency: string | null;
  status: TaskExpectationRow['status'];
}

export interface CalendarDay {
  date: string;
  entries: CalendarEntry[];
}

/**
 * Read-only view of the calendar (spec 015). Calendar has no logic of its own:
 * it aggregates the expectations that tasks already computed, so a read never
 * re-evaluates a rule and an amount shown here is always an estimate.
 */
@Injectable()
export class CalendarService {
  constructor(private readonly repo: TasksRepository) {}

  /** Day-by-day aggregation for a range, days without entries included only when asked. */
  async range(from: string, to: string): Promise<CalendarDay[]> {
    if (!isIsoDay(from)) throw new BadRequestException('invalid from');
    if (!isIsoDay(to)) throw new BadRequestException('invalid to');
    if (to < from) throw new BadRequestException('to must not be before from');

    const [expectations, punctual] = await Promise.all([
      this.repo.listExpectationsInRange(from, to),
      this.repo.list({ type: 'puntual', from, to }),
    ]);
    const ids = [...new Set([...expectations.map((row) => row.taskId), ...punctual.map((row) => row.id)])];
    const byId = new Map((await this.repo.listByIds(ids)).map((task) => [task.id, task]));

    const days = new Map<string, CalendarEntry[]>();
    const covered = new Set<string>();

    for (const expectation of expectations) {
      const task = byId.get(expectation.taskId);
      if (!task) continue;
      covered.add(`${expectation.taskId}:${expectation.expectedOn}`);
      this.push(days, expectation.expectedOn, {
        taskId: task.id,
        expectationId: expectation.id,
        title: task.title,
        icon: task.icon,
        type: task.type,
        taskStatus: task.status,
        amount: expectation.estimatedAmount,
        currency: expectation.currency,
        status: expectation.status,
      });
    }

    // A punctual task without a materialized row for its day (its date is behind
    // the rolling window) still shows up: the date is the task's own data.
    for (const task of punctual) {
      if (covered.has(`${task.id}:${task.startsOn}`)) continue;
      this.push(days, task.startsOn, {
        taskId: task.id,
        expectationId: null,
        title: task.title,
        icon: task.icon,
        type: task.type,
        taskStatus: task.status,
        amount: null,
        currency: null,
        status: 'pending',
      });
    }

    return [...days.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, entries]) => ({ date, entries }));
  }

  private push(days: Map<string, CalendarEntry[]>, date: string, entry: CalendarEntry): void {
    days.set(date, [...(days.get(date) ?? []), entry]);
  }
}
