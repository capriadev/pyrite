import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LogPurgeRepository, type LogPurgeOrigin, type LogPurgeRunRow } from '../../dal/logs/log-purge.repository';
import { SettingsService } from '../settings/settings.service';
import { loggerConfig } from '../../services/logger/logger.config';
import { purgeLogs, type PurgeResult } from './log-retention';

/** Settings of the retention, with the `.env` value as the boot default (spec 023). */
export const RETENTION_DAYS_KEY = 'logs.retention_days';
export const PURGE_INTERVAL_HOURS_KEY = 'logs.purge_interval_hours';
export const DEFAULT_PURGE_INTERVAL_HOURS = 24;

export interface LogsSettings {
  retentionDays: number;
  purgeIntervalHours: number;
}

export interface PurgeRunView extends PurgeResult {
  id: string;
  origin: LogPurgeOrigin;
  retentionDays: number;
  dir: string;
  startedAt: Date;
  finishedAt: Date;
}

/**
 * Log retention (spec 023). The logger writes; this service decides when the old files go and
 * leaves a record of every pass, which is both the metrics of what was freed and the clock the
 * interval is measured against.
 *
 * The trigger always lives here, on the backend side: the logs are the backend's even when the
 * front runs on another machine, so what the front does is read this history.
 */
@Injectable()
export class LogsService {
  private readonly log = new Logger(LogsService.name);

  constructor(
    private readonly repo: LogPurgeRepository,
    private readonly settings: SettingsService,
  ) {}

  /** Effective settings, validated: a nonsense value falls back instead of breaking retention. */
  settingsView(): LogsSettings {
    return {
      retentionDays: this.retentionDays(),
      purgeIntervalHours: this.purgeIntervalHours(),
    };
  }

  /** Only the keys present change, and each is validated before it is stored. */
  async updateSettings(patch: Record<string, unknown>): Promise<LogsSettings> {
    if (patch.retentionDays !== undefined) {
      await this.settings.set(RETENTION_DAYS_KEY, this.counter(patch.retentionDays, 'retentionDays', 3650));
    }
    if (patch.purgeIntervalHours !== undefined) {
      await this.settings.set(
        PURGE_INTERVAL_HOURS_KEY,
        this.counter(patch.purgeIntervalHours, 'purgeIntervalHours', 8760),
      );
    }
    return this.settingsView();
  }

  /**
   * One retention pass: it purges the directory and records the run. `origin` says what asked for
   * it, which is what the metrics break down by.
   */
  async purge(origin: LogPurgeOrigin): Promise<PurgeRunView> {
    const startedAt = new Date();
    const retentionDays = this.retentionDays();
    const result = purgeLogs(loggerConfig.dir, { retentionDays, now: startedAt });
    const finishedAt = new Date();
    const row = await this.repo.record({
      origin,
      retentionDays,
      files: result.files,
      bytes: String(result.bytes),
      skipped: result.skipped,
      dir: loggerConfig.dir,
      startedAt,
      finishedAt,
    });
    if (result.files > 0) {
      this.log.log(`Purge (${origin}): ${result.files} file(s), ${result.bytes} bytes freed`);
    }
    return { ...this.viewOf(row), ...result };
  }

  /** Whether the configured interval has already elapsed since the last recorded pass. */
  async intervalElapsed(): Promise<boolean> {
    const last = await this.repo.lastRun();
    if (!last) return true;
    const elapsedHours = (Date.now() - last.startedAt.getTime()) / 3_600_000;
    return elapsedHours >= this.purgeIntervalHours();
  }

  /** The history the panel shows, newest first. */
  async history(limit?: unknown): Promise<PurgeRunView[]> {
    const rows = await this.repo.list(this.limit(limit));
    return rows.map((row) => this.viewOf(row));
  }

  /** Totals since the beginning: runs, files and bytes freed. */
  async summary(): Promise<{ runs: number; files: number; bytes: number; skipped: number }> {
    return this.repo.totals();
  }

  // ============ INTERNALS ============

  private viewOf(row: LogPurgeRunRow): PurgeRunView {
    return {
      id: row.id,
      origin: row.origin,
      retentionDays: row.retentionDays,
      dir: row.dir,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      files: row.files,
      bytes: Number(row.bytes),
      skipped: row.skipped,
    };
  }

  /** The setting when it is a sane number, the `.env` default otherwise. */
  private retentionDays(): number {
    const value = this.positiveInt(this.settings.get(RETENTION_DAYS_KEY));
    return value ?? loggerConfig.retentionDays;
  }

  private purgeIntervalHours(): number {
    return this.positiveInt(this.settings.get(PURGE_INTERVAL_HOURS_KEY)) ?? DEFAULT_PURGE_INTERVAL_HOURS;
  }

  private positiveInt(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }

  private limit(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 50;
    return Math.min(Math.trunc(parsed), 500);
  }

  private counter(value: unknown, label: string, max: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
      throw new BadRequestException(`${label} must be an integer between 1 and ${max}`);
    }
    return parsed;
  }
}
