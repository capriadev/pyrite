import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * File work of the log retention (spec 023), with no Nest and no database so it can be tested
 * against a temporary directory. The logger owns the naming; this module is the only place that
 * decides what may be removed, and every protection lives here.
 */

/** `backend.20260922.3.log` and `errors.20260922.1.log`: the naming pino-roll produces. */
const LOG_FILE_PATTERN = /^[a-z][a-z0-9_-]*\.(\d{8})\.\d+\.log$/i;

export interface PurgeOptions {
  /** Files whose date is older than this many days are removed. */
  retentionDays: number;
  /** Clock of the run, injectable so the assertions do not depend on the real date. */
  now?: Date;
  /**
   * Files modified within this many hours are never touched, whatever their date says: the roller
   * may be writing a segment whose name carries an older date.
   */
  minAgeHours?: number;
}

export interface PurgePlan {
  remove: string[];
  keep: string[];
  /** Names that are not log files of this application: never candidates, never counted. */
  foreign: string[];
}

export interface PurgeResult {
  files: number;
  bytes: number;
  skipped: number;
}

const DEFAULT_MIN_AGE_HOURS = 2;

/** The date a log file name carries, or null when the name is not one of ours. */
export function parseLogDate(name: string): Date | null {
  const match = LOG_FILE_PATTERN.exec(name);
  if (!match) return null;
  const raw = match[1];
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  // A name like 20261340 would roll over instead of failing: reject it explicitly.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/**
 * What a pass would do with a directory listing. Pure: it only reads the names and the clock, so
 * the decision is testable without touching the filesystem.
 */
export function planPurge(
  entries: Array<{ name: string; mtimeMs?: number }>,
  options: PurgeOptions,
): PurgePlan {
  const now = options.now ?? new Date();
  const minAgeMs = (options.minAgeHours ?? DEFAULT_MIN_AGE_HOURS) * 3_600_000;
  const cutoff = now.getTime() - options.retentionDays * 86_400_000;
  const today = now.toISOString().slice(0, 10);

  const plan: PurgePlan = { remove: [], keep: [], foreign: [] };
  for (const entry of entries) {
    const date = parseLogDate(entry.name);
    if (!date) {
      plan.foreign.push(entry.name);
      continue;
    }
    // The file of today is the one the roller has open: never a candidate.
    if (date.toISOString().slice(0, 10) === today) {
      plan.keep.push(entry.name);
      continue;
    }
    const recent = entry.mtimeMs !== undefined && now.getTime() - entry.mtimeMs < minAgeMs;
    if (date.getTime() >= cutoff || recent) plan.keep.push(entry.name);
    else plan.remove.push(entry.name);
  }
  return plan;
}

/**
 * Runs a pass over a directory: measures each file before removing it and never lets a locked or
 * vanishing file break the run - it is counted as skipped.
 */
export function purgeLogs(dir: string, options: PurgeOptions): PurgeResult {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    // A missing directory is not an error: there is simply nothing to purge.
    return { files: 0, bytes: 0, skipped: 0 };
  }

  const entries = names.map((name) => {
    const path = join(dir, name);
    try {
      return { name, mtimeMs: statSync(path).mtimeMs };
    } catch {
      return { name };
    }
  });

  const plan = planPurge(entries, options);
  let files = 0;
  let bytes = 0;
  let skipped = 0;
  for (const name of plan.remove) {
    const path = join(dir, name);
    try {
      const size = statSync(path).size;
      unlinkSync(path);
      files += 1;
      bytes += size;
    } catch {
      skipped += 1;
    }
  }
  return { files, bytes, skipped };
}
