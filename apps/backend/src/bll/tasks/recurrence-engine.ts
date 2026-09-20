import type { Currency, TaskAggregate, TaskPriceTierRow, TaskRecurrenceRow } from '../../dal/tasks/tasks.repository';

/**
 * The business-rule evaluation of the calendar (spec 015): given a task, its
 * recurrence rule, its price tiers and its payment payload, which occurrences
 * exist in a window and what estimate applies to each. Pure computation: no
 * persistence, no DI and no clock - the window arrives as a parameter, which is
 * what makes it idempotent and testable.
 */

export interface Occurrence {
  expectedOn: string;
  estimatedAmount: string | null;
  currency: Currency | null;
  tierPosition: number | null;
  /** Hour of the occurrence (`HH:MM`), null when the entry carries no time. */
  scheduledTime: string | null;
  timeTo: string | null;
  /** Free label of the entry: what the multiple punctual format uses. */
  label: string | null;
}

/** How far ahead the future is materialized; a rolling window, extended per pass. */
export const MATERIALIZATION_HORIZON_DAYS = 365;

/** Guard against a malformed rule turning the walk into an infinite loop. */
const MAX_OCCURRENCES_PER_PASS = 1000;

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
}

/** Month arithmetic clamps to the last day, so a charge on the 31st survives February. */
export function addMonths(day: string, months: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  const targetDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(targetDay, lastDay));
  return isoDay(date);
}

/** Monday of the week a day belongs to: the anchor "every N weeks" is measured from. */
function weekStartOf(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  const weekday = date.getUTCDay();
  return addDays(day, weekday === 0 ? -6 : 1 - weekday);
}

/**
 * The anniversary of `first` after N years. When the day is February 29 and the target year
 * has no such date, the rule decides: `feb28` stays in the month and `mar01` overflows to
 * March (which is what the date arithmetic does by itself).
 */
function anniversary(first: string, years: number, mode: string): string {
  const base = new Date(`${first}T00:00:00.000Z`);
  const month = base.getUTCMonth();
  const day = base.getUTCDate();
  const candidate = new Date(Date.UTC(base.getUTCFullYear() + years, month, day));
  if (candidate.getUTCMonth() === month) return isoDay(candidate);
  if (mode === 'mar01') return isoDay(candidate);
  const lastDay = new Date(Date.UTC(candidate.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return isoDay(new Date(Date.UTC(candidate.getUTCFullYear(), month, lastDay)));
}

/**
 * Day of the nth step of a series. Annual goes through the anniversary so the leap-day rule
 * applies, weekly advances whole weeks (the selected days are resolved by the caller) and
 * the rest keep the plain unit arithmetic.
 */
function stepOf(first: string, recurrence: TaskRecurrenceRow, step: number): string {
  if (recurrence.frequencyUnit === 'year') {
    return anniversary(first, step * recurrence.interval, recurrence.leapDayMode);
  }
  if (recurrence.frequencyUnit === 'month') return addMonths(first, step * recurrence.interval);
  if (recurrence.frequencyUnit === 'week') return addDays(first, step * recurrence.interval * 7);
  return addDays(first, step * recurrence.interval);
}

/**
 * The tier in force at an occurrence: the last one whose `applies_from_occurrence`
 * has already started. This is how a promo ($1000 for the first 2 charges) hands
 * over to the regular price ($2500 from the 3rd).
 */
function tierAt(tiers: TaskPriceTierRow[], index: number): TaskPriceTierRow | null {
  let current: TaskPriceTierRow | null = null;
  for (const tier of tiers) {
    if (tier.appliesFromOccurrence <= index) current = tier;
  }
  return current;
}

/**
 * The estimate of one occurrence. Tiers win because they describe a planned price
 * sequence; otherwise the payment's own price counts only when it was declared
 * fixed. A variable service (no fixed price, no tiers) stays null on purpose:
 * finance fills the real amount, the system never invents an estimate.
 */
function estimateAt(aggregate: TaskAggregate, index: number): Pick<Occurrence, 'estimatedAmount' | 'currency' | 'tierPosition'> {
  const { payment, tiers } = aggregate;
  const tier = tierAt(tiers, index);
  if (tier) {
    return { estimatedAmount: tier.amount, currency: tier.currency, tierPosition: tier.position };
  }
  if (payment?.priceFixed && payment.priceAmount) {
    return { estimatedAmount: payment.priceAmount, currency: payment.priceCurrency, tierPosition: null };
  }
  return { estimatedAmount: null, currency: null, tierPosition: null };
}

/** Charges a rule allows before it stops; null means unbounded. */
function occurrenceLimit(aggregate: TaskAggregate): number | null {
  const { recurrence, payment } = aggregate;
  if (payment && payment.mode === 'cuotas' && payment.installmentsCount) return payment.installmentsCount;
  if (recurrence?.endsMode === 'after_count' && recurrence.occurrencesCount) return recurrence.occurrencesCount;
  return null;
}

/** First charge of a payment: the trial delays it, installments have no trial. */
function firstChargeDay(aggregate: TaskAggregate): string {
  const { task, payment } = aggregate;
  if (payment && payment.mode !== 'cuotas' && payment.trialDays > 0) {
    return addDays(task.startsOn, payment.trialDays);
  }
  return task.startsOn;
}

/** Entry of the punctual format: a range (or a single day) plus its hour and label. */
interface PunctualEntry {
  from: string;
  to: string;
  time: string | null;
  timeTo: string | null;
  label: string | null;
}

function punctualEntries(aggregate: TaskAggregate): PunctualEntry[] {
  const { task, dates } = aggregate;
  if (dates.length === 0) {
    return [{ from: task.startsOn, to: task.startsOn, time: null, timeTo: null, label: null }];
  }
  return dates.map((row) => ({
    from: row.date,
    to: row.dateTo ?? row.date,
    time: row.time,
    timeTo: row.timeTo,
    label: row.label,
  }));
}

/** A punctual task shows on every day its entries cover, each with its own metadata. */
function punctualOccurrences(aggregate: TaskAggregate, from: string, to: string): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const entry of punctualEntries(aggregate)) {
    let day = entry.from;
    while (day <= entry.to) {
      if (day >= from && day <= to) {
        occurrences.push({
          expectedOn: day,
          ...estimateAt(aggregate, 1),
          scheduledTime: entry.time,
          timeTo: entry.timeTo,
          label: entry.label,
        });
      }
      day = addDays(day, 1);
    }
  }
  return occurrences.sort(byDate);
}

/**
 * A weekly rule with selected days: inside each week step it emits those days in ISO order.
 * The step is anchored to the week of the first charge, so "every 2 weeks" is one week with
 * the task and one without. A single hour among the days acts as the global one.
 */
function weeklyOccurrences(aggregate: TaskAggregate, from: string, to: string): Occurrence[] {
  const { recurrence, weekdays } = aggregate;
  if (!recurrence) return [];
  const days = [...weekdays].sort((a, b) => a.weekday - b.weekday);
  const globalTime = days.find((day) => day.time)?.time ?? null;
  const globalTimeTo = days.find((day) => day.timeTo)?.timeTo ?? null;
  const first = firstChargeDay(aggregate);
  const limit = occurrenceLimit(aggregate);
  const endsOn = recurrence.endsMode === 'on_date' ? recurrence.endsOn : null;
  const occurrences: Occurrence[] = [];
  let index = 0;

  for (let week = 0; week <= MAX_OCCURRENCES_PER_PASS; week += 1) {
    const start = addDays(weekStartOf(first), week * 7 * recurrence.interval);
    if (start > to) break;
    for (const day of days) {
      const date = addDays(start, day.weekday - 1);
      if (date < first) continue;
      index += 1;
      if (limit !== null && index > limit) return occurrences.sort(byDate);
      if (endsOn && date > endsOn) return occurrences.sort(byDate);
      if (date >= from && date <= to) {
        occurrences.push({
          expectedOn: date,
          ...estimateAt(aggregate, index),
          scheduledTime: day.time ?? globalTime,
          timeTo: day.timeTo ?? globalTimeTo,
          label: null,
        });
      }
    }
  }
  return occurrences.sort(byDate);
}

/** Daily, monthly and annual series: one day per step, until an end condition fires. */
function seriesOccurrences(aggregate: TaskAggregate, from: string, to: string): Occurrence[] {
  const recurrence = aggregate.recurrence;
  if (!recurrence) return [];
  const first = firstChargeDay(aggregate);
  const limit = occurrenceLimit(aggregate);
  const endsOn = recurrence.endsMode === 'on_date' ? recurrence.endsOn : null;
  const occurrences: Occurrence[] = [];

  for (let index = 1; index <= MAX_OCCURRENCES_PER_PASS; index += 1) {
    const cursor = stepOf(first, recurrence, index - 1);
    if (cursor > to) break;
    if (endsOn && cursor > endsOn) break;
    if (limit !== null && index > limit) break;
    if (cursor >= from) {
      occurrences.push({
        expectedOn: cursor,
        ...estimateAt(aggregate, index),
        scheduledTime: recurrence.time,
        timeTo: recurrence.timeTo,
        label: null,
      });
    }
  }
  return occurrences;
}

const byDate = (a: Occurrence, b: Occurrence): number => {
  if (a.expectedOn < b.expectedOn) return -1;
  return a.expectedOn > b.expectedOn ? 1 : 0;
};

/**
 * Occurrences of a task inside [from, to]: a punctual task expands its dated entries, a
 * weekly rule with selected days resolves them per week and the rest walk their series.
 * The engine stays pure: no persistence, no DI and no clock.
 */
export function occurrencesOf(aggregate: TaskAggregate, from: string, to: string): Occurrence[] {
  const { task, recurrence } = aggregate;
  if (task.status !== 'active') return [];
  if (task.type === 'puntual' || !recurrence) return punctualOccurrences(aggregate, from, to);
  if (recurrence.frequencyUnit === 'week' && aggregate.weekdays.length > 0) {
    return weeklyOccurrences(aggregate, from, to);
  }
  return seriesOccurrences(aggregate, from, to);
}
