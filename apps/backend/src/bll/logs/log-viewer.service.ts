import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { loggerConfig } from '../../services/logger/logger.config';
import {
  isLogFileName,
  listLogFiles,
  parseCursor,
  readEntries,
  tailFile,
  type EntriesPage,
  type LogEntry,
  type LogFileInfo,
} from './log-reader';

/**
 * Reading side of the logs (spec 024). The retention (023) owns what is on disk; this service only
 * reads it, so validation lives here: a nonsense query is a 400 and a name that is not a log file is
 * refused before anything is opened.
 */

const LEVELS = ['debug', 'info', 'warn', 'error'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STREAM = /^[a-z][a-z0-9_-]*$/i;
const MAX_LIMIT = 1000;
const MAX_LINES_QUERY = 20_000;
const MAX_TAIL_LINES = 500;
const MAX_TEXT = 200;

export interface LogFilesView {
  dir: string;
  files: LogFileInfo[];
  foreign: string[];
  totals: { files: number; bytes: number };
}

@Injectable()
export class LogViewerService {
  /** The listing the panel shows: what is on disk, newest first, foreign names apart. */
  files(): LogFilesView {
    const listing = listLogFiles(loggerConfig.dir);
    return {
      dir: loggerConfig.dir,
      files: listing.files,
      foreign: listing.foreign,
      totals: {
        files: listing.files.length,
        bytes: listing.files.reduce((sum, file) => sum + file.bytes, 0),
      },
    };
  }

  /** A filtered page of entries, plus the cursor to continue. */
  entries(query: Record<string, unknown>): EntriesPage {
    return readEntries(loggerConfig.dir, {
      stream: this.stream(query.stream),
      levels: this.levels(query.level ?? query.levels),
      q: this.text(query.q, 'q'),
      reqId: this.text(query.reqId, 'reqId'),
      from: this.day(query.from, 'from'),
      to: this.day(query.to, 'to'),
      limit: this.bounded(query.limit, 'limit', MAX_LIMIT),
      maxLines: this.bounded(query.maxLines, 'maxLines', MAX_LINES_QUERY),
      cursor: this.cursor(query.cursor),
    });
  }

  /** The latest lines of one file: what the screen shows when it opens. */
  tail(file: unknown, lines: unknown): { file: string; entries: LogEntry[] } {
    const name = this.fileName(file);
    const wanted = this.bounded(lines, 'lines', MAX_TAIL_LINES) ?? 100;
    return { file: name, entries: tailFile(loggerConfig.dir, name, wanted) };
  }

  /**
   * The absolute path of a file the caller may download. Only logger names pass, so a name with
   * separators never reaches the filesystem, and a missing file is a 404 instead of an empty body.
   */
  rawPath(name: unknown): { file: string; path: string; bytes: number } {
    const file = this.fileName(name);
    const path = join(loggerConfig.dir, file);
    try {
      return { file, path, bytes: statSync(path).size };
    } catch {
      throw new NotFoundException(`${file} is not on disk`);
    }
  }

  // ============ INTERNALS ============

  private fileName(value: unknown): string {
    if (typeof value !== 'string' || !isLogFileName(value)) {
      throw new BadRequestException('file must be a log file name');
    }
    return value;
  }

  private stream(value: unknown): string | undefined {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !STREAM.test(value)) {
      throw new BadRequestException('stream is not valid');
    }
    return value;
  }

  private levels(value: unknown): string[] | undefined {
    if (value === undefined || value === '') return undefined;
    const raw = Array.isArray(value) ? value.map(String) : String(value).split(',');
    const wanted = raw.map((level) => level.trim().toLowerCase()).filter((level) => level.length > 0);
    if (wanted.length === 0) return undefined;
    const unknown = wanted.filter((level) => !LEVELS.includes(level));
    if (unknown.length > 0) throw new BadRequestException(`unknown level: ${unknown.join(', ')}`);
    return wanted;
  }

  private text(value: unknown, label: string): string | undefined {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || value.length > MAX_TEXT) {
      throw new BadRequestException(`${label} must be a string of at most ${MAX_TEXT} characters`);
    }
    return value;
  }

  private day(value: unknown, label: string): string | undefined {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !DAY.test(value) || Number.isNaN(Date.parse(value))) {
      throw new BadRequestException(`${label} must be a date as YYYY-MM-DD`);
    }
    return value;
  }

  private cursor(value: unknown): string | undefined {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !parseCursor(value)) {
      throw new BadRequestException('cursor is not valid');
    }
    return value;
  }

  /** A positive integer up to `max`; anything else is a 400 instead of a silent clamp. */
  private bounded(value: unknown, label: string, max: number): number | undefined {
    if (value === undefined || value === '') return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
      throw new BadRequestException(`${label} must be an integer between 1 and ${max}`);
    }
    return parsed;
  }
}
