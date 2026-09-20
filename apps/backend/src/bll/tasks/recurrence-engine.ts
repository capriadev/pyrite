import type { Currency, TaskAggregate, TaskPriceTierRow } from '../../dal/tasks/tasks.repository';

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

function advance(day: string, unit: string, interval: number): string {
  if (unit === 'day') return addDays(day, interval);
  if (unit === 'week') return addDays(day, interval * 7);
  if (unit === 'year') return addMonths(day, interval * 12);
  return addMonths(day, interval);
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

/**
 * Occurrences of a task inside [from, to]. A punctual task yields its single date;
 * a recurring one walks the series until it leaves the window or hits its end.
 */
export function occurrencesOf(aggregate: TaskAggregate, from: string, to: string): Occurrence[] {
  const { task, recurrence } = aggregate;
  if (task.status !== 'active') return [];

  if (task.type === 'puntual' || !recurrence) {
    if (task.startsOn < from || task.startsOn > to) return [];
    return [{ expectedOn: task.startsOn, ...estimateAt(aggregate, 1) }];
  }

  const limit = occurrenceLimit(aggregate);
  const endsOn = recurrence.endsMode === 'on_date' ? recurrence.endsOn : null;
  const occurrences: Occurrence[] = [];
  let cursor = firstChargeDay(aggregate);

  for (let index = 1; index <= MAX_OCCURRENCES_PER_PASS; index += 1) {
    if (cursor > to) break;
    if (endsOn && cursor > endsOn) break;
    if (limit !== null && index > limit) break;
    if (cursor >= from) occurrences.push({ expectedOn: cursor, ...estimateAt(aggregate, index) });
    cursor = advance(cursor, recurrence.frequencyUnit, recurrence.interval);
  }

  return occurrences;
}
