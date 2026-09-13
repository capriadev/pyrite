import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerConfig {
  /** Active level. Runtime is info; set LOG_LEVEL=debug to hunt a specific problem. */
  level: LogLevel;
  /** Directory for backend log files (repo-level logs/backend). */
  dir: string;
  /** Pretty console output (dev) vs raw JSON Lines (prod). */
  prettyConsole: boolean;
  /**
   * Maximum size per file before rolling, as pino-roll's `size` accepts it:
   * a bare number (or numeric string) means MB, or an explicit unit suffix
   * `k` (KB), `m` (MB), `g` (GB). Example: `100m`, `500k`, `1g`, `100`.
   */
  maxFileSize: string;
  /** Log files older than this many days are purged at boot. */
  retentionDays: number;
}

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
/** pino-roll size syntax: optional digits plus an optional k/m/g unit. */
const SIZE_PATTERN = /^\d+(\.\d+)?[kmg]?$/i;
const DEFAULT_MAX_FILE_SIZE = '100m';

function parseLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? 'info').toLowerCase();
  return (LEVELS as string[]).includes(value) ? (value as LogLevel) : 'info';
}

/**
 * Validates a pino-roll size value. A bare number counts as MB, which is the
 * library's own convention, so anything not matching the k/m/g shape falls back
 * to the default instead of silently producing a wrong ceiling.
 */
function parseMaxFileSize(raw: string | undefined): string {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return DEFAULT_MAX_FILE_SIZE;
  if (!SIZE_PATTERN.test(value)) return DEFAULT_MAX_FILE_SIZE;
  return value;
}

/**
 * Finds the repository root by walking up from this file until a package.json
 * with a workspaces field is found. Independent of the process cwd, so running
 * from the repo root or from apps/backend resolves the same logs/ folder.
 */
function findRepoRoot(): string {
  let current = __dirname;
  const { root } = parse(current);
  while (true) {
    const pkgPath = join(current, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { workspaces?: unknown };
        if (pkg.workspaces) return current;
      } catch {
        // keep walking up on unreadable package.json
      }
    }
    if (current === root) return process.cwd();
    current = dirname(current);
  }
}

/**
 * Logging config, read from the backend .env with local defaults.
 * Logs live at the repo root (logs/backend) so all processes share one tree.
 */
export const loggerConfig: LoggerConfig = {
  level: parseLevel(process.env.LOG_LEVEL),
  dir: process.env.LOG_DIR ?? join(findRepoRoot(), 'logs', 'backend'),
  prettyConsole: (process.env.NODE_ENV ?? 'development') !== 'production',
  maxFileSize: parseMaxFileSize(process.env.LOG_MAX_FILE_SIZE),
  retentionDays: Number(process.env.LOG_RETENTION_DAYS ?? 120),
};

/**
 * Paths never written to any log record. pino only redacts what is listed here,
 * so this list is the hard rule, not an intention. Passwords, passphrases,
 * master keys, peppers, tokens, api keys and auth headers are always removed.
 */
export const REDACT_PATHS: string[] = [
  'password',
  'passphrase',
  'masterKey',
  'pepper',
  'secret',
  'token',
  'apiKey',
  '*.password',
  '*.passphrase',
  '*.masterKey',
  '*.pepper',
  '*.secret',
  '*.token',
  '*.apiKey',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
];
