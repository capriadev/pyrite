/**
 * Boundary guards shared by more than one layer. Pure functions, no DI: the
 * gateway checks ids before they reach SQL and the BLL checks them again where
 * the value travels further.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres answers a malformed uuid with a 500, so ids are checked before they reach SQL. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** ISO calendar day (`YYYY-MM-DD`): the only date format this API accepts. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(value: string): boolean {
  return DAY_PATTERN.test(value);
}
