import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../drizzle/schema';

export const DRIZZLE_DB = Symbol('DRIZZLE_DB');

export type DrizzleDb = NodePgDatabase<typeof schema>;

/** Transaction-scoped handle: same query API, no `transaction()` of its own. */
export type DrizzleTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

/**
 * Runs a write set atomically. Used by the rotation apply step, where the canary
 * and every re-encrypted row must land together or not at all.
 */
export function withTransaction<T>(db: DrizzleDb, fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

