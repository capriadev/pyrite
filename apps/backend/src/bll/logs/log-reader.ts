import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseLogDate } from './log-retention';

/**
 * Reading side of the logs (spec 024), with no Nest and no database so it can be tested against a
 * temporary directory. It shares the naming rule with the retention (`parseLogDate`): a file this
 * module serves is a file the purge knows about, and nothing else is ever read.
 */

/** The parts of `backend.20260922.3.log`: stream, date and segment. */
const NAME_PARTS = /^([a-z][a-z0-9_-]*)\.(\d{8})\.(\d+)\.log$/i;

/** Entries returned when the caller does not say. */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
/** Candidate lines a single request may look at before handing back a cursor. */
export const DEFAULT_MAX_LINES = 5000;
export const MAX_MAX_LINES = 20000;
/** Chunk used to walk a file without loading it whole. */
const CHUNK_BYTES = 64 * 1024;

export interface LogFileInfo {
  name: string;
  stream: string;
  /** `YYYY-MM-DD` carried by the name. */
  date: string;
  segment: number;
  bytes: number;
  modifiedAt: string;
}

export interface LogFileListing {
  files: LogFileInfo[];
  /** Names in the directory that are not log files of this application: never served. */
  foreign: string[];
}

export interface LogEntry {
  time: string | null;
  level: string | null;
  msg: string | null;
  reqId: string | null;
  context: string | null;
  /** The original line, always present: what a broken line has instead of fields. */
  raw: string;
}

export interface EntriesQuery {
  stream?: string;
  levels?: string[];
  /** Case-insensitive substring over msg, context and the raw line. */
  q?: string;
  reqId?: string;
  /** Inclusive day range matched against the date in the file name. */
  from?: string;
  to?: string;
  limit?: number;
  maxLines?: number;
  /** Resume point, as produced by a previous call. */
  cursor?: string;
}

export interface EntriesPage {
  entries: LogEntry[];
  /** Where to continue, or null when the range was read to the end. */
  nextCursor: string | null;
  scannedLines: number;
  filesScanned: number;
  /** True when a cap stopped the walk before the last file. */
  truncated: boolean;
}

/** A parsed line, with nulls when the line is not JSON the logger wrote. */
export function parseEntry(line: string): LogEntry {
  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    return {
      time: text(parsed.time),
      level: text(parsed.level),
      msg: text(parsed.msg),
      reqId: text(parsed.reqId),
      context: text(parsed.context),
      raw: line,
    };
  } catch {
    return { time: null, level: null, msg: null, reqId: null, context: null, raw: line };
  }
}

/** The parts of a logger name, or null when the name is not one of ours. */
export function logNameParts(name: string): { stream: string; date: string; segment: number } | null {
  if (!parseLogDate(name)) return null;
  const match = NAME_PARTS.exec(name);
  if (!match) return null;
  const stamp = match[2];
  return {
    stream: match[1],
    date: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`,
    segment: Number(match[3]),
  };
}

/** One entry per log file, newest first; foreign names are reported but never served. */
export function listLogFiles(dir: string): LogFileListing {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    // A missing directory is not an error: there is simply nothing to read.
    return { files: [], foreign: [] };
  }

  const files: LogFileInfo[] = [];
  const foreign: string[] = [];
  for (const name of names) {
    const parts = logNameParts(name);
    if (!parts) {
      foreign.push(name);
      continue;
    }
    let bytes = 0;
    let modifiedAt = new Date(0).toISOString();
    try {
      const stats = statSync(join(dir, name));
      bytes = stats.size;
      modifiedAt = new Date(stats.mtimeMs).toISOString();
    } catch {
      // A file that vanished between the listing and the stat is listed as empty.
    }
    files.push({ name, ...parts, bytes, modifiedAt });
  }

  files.sort((a, b) => (a.date === b.date ? b.segment - a.segment : a.date < b.date ? 1 : -1));
  return { files, foreign };
}

/** Parses `name:offset`, the cursor this module hands out. */
export function parseCursor(cursor: string): { name: string; offset: number } | null {
  const cut = cursor.lastIndexOf(':');
  if (cut <= 0) return null;
  const offset = Number(cursor.slice(cut + 1));
  if (!Number.isInteger(offset) || offset < 0) return null;
  const name = cursor.slice(0, cut);
  return logNameParts(name) ? { name, offset } : null;
}

/**
 * The files a query covers, oldest first: a page walks forward in time. A cursor whose file is gone
 * (purged in the meantime) resumes from the first file at or after its name, which is why the name
 * embeds the date.
 */
/** Chronological order: date, then segment, then name as the final tie-break. */
function compareFiles(a: LogFileInfo, b: LogFileInfo): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.segment !== b.segment) return a.segment - b.segment;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function filesForQuery(
  files: LogFileInfo[],
  query: EntriesQuery,
  resumeFrom: string | null,
): LogFileInfo[] {
  const selected = files
    .filter((file) => (query.stream ? file.stream === query.stream : true))
    .filter((file) => (query.from ? file.date >= query.from : true))
    .filter((file) => (query.to ? file.date <= query.to : true))
    .sort(compareFiles);
  if (!resumeFrom) return selected;
  // The cursor names a file: resuming keeps that one and everything after it in the same order the
  // walk uses, so a segment repeated across streams cannot make it skip a file.
  const parts = logNameParts(resumeFrom);
  if (!parts) return selected;
  const from: LogFileInfo = { name: resumeFrom, ...parts, bytes: 0, modifiedAt: '' };
  return selected.filter((file) => compareFiles(file, from) >= 0);
}

/** Whether an entry passes the filters. Level and reqId compare exactly; text is a substring. */
function matches(entry: LogEntry, query: EntriesQuery): boolean {
  if (query.levels && query.levels.length > 0) {
    if (!entry.level || !query.levels.includes(entry.level)) return false;
  }
  if (query.reqId && entry.reqId !== query.reqId) return false;
  if (query.q) {
    const needle = query.q.toLowerCase();
    const haystack = `${entry.msg ?? ''} ${entry.context ?? ''} ${entry.raw}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/**
 * Reads the range and answers with a page plus where to continue. Reading is bounded twice: the
 * entries a page returns and the candidate lines a request looks at, so a wide search is several
 * cheap requests instead of one that loads everything.
 */
export function readEntries(dir: string, query: EntriesQuery): EntriesPage {
  const limit = clamp(query.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const maxLines = clamp(query.maxLines ?? DEFAULT_MAX_LINES, 1, MAX_MAX_LINES);
  const cursor = query.cursor ? parseCursor(query.cursor) : null;
  const listing = listLogFiles(dir);
  const files = filesForQuery(listing.files, query, cursor ? cursor.name : null);

  const entries: LogEntry[] = [];
  let scannedLines = 0;
  let filesScanned = 0;

  for (const file of files) {
    const startOffset = cursor && cursor.name === file.name ? cursor.offset : 0;
    const stop = readFile(
      join(dir, file.name),
      startOffset,
      () => entries.length >= limit || scannedLines >= maxLines,
      (entry) => {
        scannedLines += 1;
        if (matches(entry, query)) entries.push(entry);
      },
    );
    filesScanned += 1;
    if (stop.stopped) {
      return {
        entries,
        nextCursor: `${file.name}:${stop.offset}`,
        scannedLines,
        filesScanned,
        truncated: true,
      };
    }
  }

  return { entries, nextCursor: null, scannedLines, filesScanned, truncated: false };
}

/**
 * Walks one file from `startOffset`, handing every complete line to `onLine`. A line still being
 * written (no closing newline) is left for the next call, and a file the roller holds open on
 * Windows ends the walk instead of failing it.
 */
function readFile(
  path: string,
  startOffset: number,
  shouldStop: () => boolean,
  onLine: (entry: LogEntry) => void,
): { stopped: boolean; offset: number } {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return { stopped: false, offset: startOffset };
  }

  let offset = startOffset;
  let position = startOffset;
  let pending = Buffer.alloc(0);
  try {
    while (!shouldStop()) {
      const chunk = Buffer.alloc(CHUNK_BYTES);
      let read = 0;
      try {
        read = readSync(fd, chunk, 0, CHUNK_BYTES, position);
      } catch {
        // A sharing violation on the file of today: what was read stands, the walk moves on.
        return { stopped: false, offset };
      }
      if (read === 0) break;
      position += read;
      pending = Buffer.concat([pending, chunk.subarray(0, read)]);

      let newline = pending.indexOf(0x0a);
      while (newline >= 0) {
        const line = pending.subarray(0, newline).toString('utf8').replace(/\r$/, '');
        pending = pending.subarray(newline + 1);
        offset += newline + 1;
        if (line.length > 0) onLine(parseEntry(line));
        if (shouldStop()) return { stopped: true, offset };
        newline = pending.indexOf(0x0a);
      }
    }
    // What is left without a newline is a line mid-write: it stays for the next request.
    return { stopped: shouldStop(), offset };
  } finally {
    closeSync(fd);
  }
}

/** The last `lines` entries of one file, read backwards in chunks. */
export function tailFile(dir: string, name: string, lines: number): LogEntry[] {
  if (!logNameParts(name)) return [];
  const wanted = clamp(lines, 1, 500);
  const path = join(dir, name);
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return [];
  }

  try {
    const size = statSync(path).size;
    // A file that does not end with a newline has a line still being written: it is not an entry yet.
    const ended = Buffer.alloc(1);
    let complete = true;
    if (size > 0) {
      try {
        complete = readSync(fd, ended, 0, 1, size - 1) === 1 && ended[0] === 0x0a;
      } catch {
        complete = true;
      }
    }
    let end = size;
    const pieces: Buffer[] = [];
    let newlines = 0;
    while (end > 0 && newlines <= wanted) {
      const start = Math.max(0, end - CHUNK_BYTES);
      const length = end - start;
      const buffer = Buffer.alloc(length);
      let read = 0;
      try {
        read = readSync(fd, buffer, 0, length, start);
      } catch {
        break;
      }
      const piece = buffer.subarray(0, read);
      for (const byte of piece) if (byte === 0x0a) newlines += 1;
      pieces.unshift(piece);
      end = start;
    }
    const lines = Buffer.concat(pieces)
      .toString('utf8')
      .split('\n')
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line.length > 0);
    if (!complete) lines.pop();
    return lines.slice(-wanted).map(parseEntry);
  } catch {
    return [];
  } finally {
    closeSync(fd);
  }
}

/** A name is servable only when it is a logger name: no separators, no escapes. */
export function isLogFileName(name: string): boolean {
  return logNameParts(name) !== null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

