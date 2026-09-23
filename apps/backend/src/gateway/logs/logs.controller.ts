import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { LogsService, type LogsSettings, type PurgeRunView } from '../../bll/logs/logs.service';

/**
 * Logs gateway (spec 023). The trigger and the data live on the backend side because the logs are
 * the backend's: the front only reads the history and the totals.
 */
@Controller('logs')
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  /** Effective retention settings: what the settings screen shows. */
  @Get('settings')
  settingsView(): LogsSettings {
    return this.logs.settingsView();
  }

  /** Retention days and interval; only the keys present change, each one validated. */
  @Post('settings')
  updateSettings(@Body() body: Record<string, unknown>): Promise<LogsSettings> {
    return this.logs.updateSettings(body ?? {});
  }

  /** Manual pass: runs now, records the run and returns what it freed. */
  @Post('purge')
  @HttpCode(201)
  purge(): Promise<PurgeRunView> {
    return this.logs.purge('manual');
  }

  /** The history of passes, newest first. */
  @Get('purges')
  history(@Query('limit') limit?: string): Promise<PurgeRunView[]> {
    return this.logs.history(limit);
  }

  /** Totals since the beginning: runs, files and bytes freed. */
  @Get('purges/summary')
  summary(): Promise<{ runs: number; files: number; bytes: number; skipped: number }> {
    return this.logs.summary();
  }
}
