/**
 * Calendar-day arithmetic shared by more than one domain (spec 025). Pure functions with no DI and
 * no timezone games: the day is always `YYYY-MM-DD` in UTC, which is the format the API uses.
 *
 * They live here, next to the guards, so a domain that needs a date helper does not have to reach
 * into another domain's engine.
 */

/** A `Date` as the ISO calendar day the API speaks. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A day moved by a number of days, forwards or backwards. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
}
