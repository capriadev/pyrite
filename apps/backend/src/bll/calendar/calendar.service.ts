import { BadRequestException, Injectable } from '@nestjs/common';
import { TasksService, type CalendarInput } from '../tasks/tasks.service';
import type { TaskExpectationRow, TaskRow } from '../../dal/tasks/tasks.repository';
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
  /** Hour of the entry, its optional end and its free label: metadata the detail view reads. */
  scheduledTime: string | null;
  timeTo: string | null;
  label: string | null;
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
 *
 * It asks the tasks domain for that material (spec 025) instead of reading its
 * repository: a change in how tasks stores things stays inside tasks.
 */
@Injectable()
export class CalendarService {
  constructor(private readonly tasks: TasksService) {}

  /** Day-by-day aggregation for a range, days without entries included only when asked. */
  async range(from: string, to: string): Promise<CalendarDay[]> {
    if (!isIsoDay(from)) throw new BadRequestException('invalid from');
    if (!isIsoDay(to)) throw new BadRequestException('invalid to');
    if (to < from) throw new BadRequestException('to must not be before from');

    const { expectations, punctual, tasks }: CalendarInput = await this.tasks.calendarInput(from, to);
    const byId = new Map(tasks.map((task) => [task.id, task]));

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
        scheduledTime: expectation.scheduledTime,
        timeTo: expectation.timeTo,
        label: expectation.label,
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
        scheduledTime: null,
        timeTo: null,
        label: null,
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
