import { Injectable, type LoggerService as NestLoggerService } from '@nestjs/common';
import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import pino, {
  multistream,
  type Logger as PinoLogger,
  type DestinationStream,
} from 'pino';
import { loggerConfig, REDACT_PATHS, type LogLevel } from './logger.config';
import { getRequestContext } from './request-context';

/** Names accepted by Nest's Logger calls. */
type NestLogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';

const LEVEL_MAP: Record<NestLogLevel, LogLevel> = {
  log: 'info',
  error: 'error',
  warn: 'warn',
  debug: 'debug',
  verbose: 'debug',
  fatal: 'error',
};

const ERROR_LABEL = 'errors';

/**
 * Writes every log record to disk as JSON Lines, with correlation ids and
 * automatic redaction, and mirrors it to the console.
 *
 * Two rotating files, both named `name.YYYYMMDD.N.log` by pino-roll:
 * - `backend.YYYYMMDD.N.log`   everything at the active level
 * - `errors.YYYYMMDD.N.log`    warn and error records only (duplicated)
 *
 * Rotation is delegated to pino-roll: `frequency: daily` opens a new date
 * segment when the day changes, `dateFormat` produces the compact `YYYYMMDD`
 * segment and `size` rolls to the next `N` when a file reaches the ceiling.
 */
@Injectable()
export class LoggerService implements NestLoggerService {
  private baseLogger!: PinoLogger;
  private errorLogger!: PinoLogger;
  /** Worker-thread transports created for pino-roll, closed on shutdown. */
  private transports: ReturnType<typeof pino.transport>[] = [];

  async init(): Promise<void> {
    await this.purgeExpired();
    this.baseLogger = await this.buildLogger('backend');
    this.errorLogger = await this.buildLogger(ERROR_LABEL);
  }

  private async buildLogger(name: string): Promise<PinoLogger> {
    // pino.transport runs the roller in a worker thread, so the options are
    // structured-cloned. Note: a bare size number means MB, not bytes.
    const transport = pino.transport({
      target: 'pino-roll',
      options: {
        file: join(loggerConfig.dir, name),
        frequency: 'daily',
        dateFormat: 'yyyyMMdd',
        size: loggerConfig.maxFileSize,
        mkdir: true,
      },
    });

    const streams: DestinationStream[] = [transport];
    if (loggerConfig.prettyConsole) {
      const { default: pretty } = await import('pino-pretty');
      streams.push(pretty({ colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' }));
    } else {
      streams.push(process.stdout);
    }

    const logger = pino(
      {
        level: loggerConfig.level,
        redact: { paths: REDACT_PATHS, remove: true },
        formatters: { level: (label) => ({ level: label }) },
        mixin: () => {
          const ctx = getRequestContext();
          return ctx ? { reqId: ctx.reqId } : {};
        },
      },
      multistream(streams, { dedupe: false }),
    );
    this.transports.push(transport);
    return logger;
  }

  /** Duplicates warn/error records into the errors file. */
  private mirrorToErrors(level: NestLogLevel, message: unknown, context?: string, meta?: unknown): void {
    if (level !== 'warn' && level !== 'error') return;
    const text = this.stringify(message);
    const payload = meta && typeof meta === 'object' ? { ...(meta as Record<string, unknown>) } : {};
    delete payload.msg;
    if (level === 'error') this.errorLogger.error({ ...payload, context }, text);
    else this.errorLogger.warn({ ...payload, context }, text);
  }

  private stringify(message: unknown): string {
    if (typeof message === 'string') return message;
    if (message instanceof Error) return message.message;
    return String(message);
  }

  private write(level: NestLogLevel, message: unknown, context?: string, meta?: unknown): void {
    const text = this.stringify(message);
    // A stack is attached to Error instances so failures stay traceable.
    const payload =
      message instanceof Error && message.stack
        ? { stack: message.stack, ...(meta as object) }
        : meta && typeof meta === 'object'
          ? (meta as Record<string, unknown>)
          : meta === undefined
            ? {}
            : { detail: meta };

    const levelName = LEVEL_MAP[level];
    this.baseLogger[levelName]({ context, ...payload }, text);
    this.mirrorToErrors(level, message, context, meta);
  }

  log(message: unknown, context?: string, meta?: unknown): void {
    this.write('log', message, context, meta);
  }

  error(message: unknown, context?: string, meta?: unknown): void {
    this.write('error', message, context, meta);
  }

  warn(message: unknown, context?: string, meta?: unknown): void {
    this.write('warn', message, context, meta);
  }

  debug(message: unknown, context?: string, meta?: unknown): void {
    this.write('debug', message, context, meta);
  }

  verbose(message: unknown, context?: string, meta?: unknown): void {
    this.write('verbose', message, context, meta);
  }

  fatal(message: unknown, context?: string, meta?: unknown): void {
    this.write('fatal', message, context, meta);
  }

  /** Flushes the active files; called on application shutdown. */
  close(): void {
    for (const transport of this.transports) {
      try {
        transport.end();
      } catch {
        // a transport already closed must not block shutdown
      }
    }
    this.transports = [];
  }

  /** Removes log files whose date is older than the retention window. */
  private async purgeExpired(): Promise<void> {
    const cutoff = Date.now() - loggerConfig.retentionDays * 86_400_000;
    let entries: string[];
    try {
      entries = readdirSync(loggerConfig.dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const date = this.parseFileDate(name);
      if (date === null || date >= cutoff) continue;
      try {
        unlinkSync(join(loggerConfig.dir, name));
      } catch {
        // a locked or missing file must not block boot
      }
    }
  }

  /** Extracts the yyyyMMdd date embedded in a log filename, if present. */
  private parseFileDate(name: string): number | null {
    const match = /\.(\d{8})\./.exec(name);
    if (!match) return null;
    const y = Number(match[1].slice(0, 4));
    const m = Number(match[1].slice(4, 6)) - 1;
    const d = Number(match[1].slice(6, 8));
    const time = new Date(y, m, d).getTime();
    return Number.isNaN(time) ? null : time;
  }
}
