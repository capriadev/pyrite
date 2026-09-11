import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../drizzle/schema';

export const DRIZZLE_DB = Symbol('DRIZZLE_DB');

export type DrizzleDb = NodePgDatabase<typeof schema>;

