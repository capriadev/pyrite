import { Body, Controller, Get, HttpCode, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { LogsService, type LogsSettings, type PurgeRunView } from '../../bll/logs/logs.service';
import { LogViewerService, type LogFilesView } from '../../bll/logs/log-viewer.service';
import type { EntriesPage, LogEntry } from '../../bll/logs/log-reader';

/**
 * Logs gateway (spec 023 for the retention, spec 024 for the reading). The trigger and the data live
 * on the backend side because the logs are the backend's: the front only reads.
 */
@Controller('logs')
export class LogsController {
  constructor(
    private readonly logs: LogsService,
    private readonly viewer: LogViewerService,
  ) {}

  /** The listing of log files, newest first (spec 024). */
  @Get('files')
  files(): LogFilesView {
    return this.viewer.files();
  }

  /** A filtered page of entries plus the cursor to continue. */
  @Get('entries')
  entries(@Query() query: Record<string, unknown>): EntriesPage {
    return this.viewer.entries(query ?? {});
  }

  /** The latest lines of one file: what the screen shows when it opens. */
  @Get('tail')
  tail(@Query('file') file?: string, @Query('lines') lines?: string): { file: string; entries: LogEntry[] } {
    return this.viewer.tail(file, lines);
  }

  /** The file as-is, for a download. Only logger names are servable. */
  @Get('files/:name/raw')
  raw(@Param('name') name: string): StreamableFile {
    const found = this.viewer.rawPath(name);
    return new StreamableFile(createReadStream(found.path), {
      type: 'text/plain; charset=utf-8',
      disposition: `attachment; filename="${found.file}"`,
    });
  }

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
