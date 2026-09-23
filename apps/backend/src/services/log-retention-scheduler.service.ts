import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { LogsService } from '../bll/logs/logs.service';

/**
 * Trigger of the log retention (spec 023).
 *
 * - One pass at boot: the `LoggerService` used to purge there, and moving it here is what makes
 *   the boot pass recorded like any other.
 * - One check every hour: the pass only runs when the configured interval has elapsed since the
 *   last recorded run. Reading the clock from the table is what makes the interval survive a
 *   restart and change without rescheduling anything.
 * - The manual endpoint lives in the gateway and asks for its own pass.
 *
 * A failing pass never brings the app down: it is logged and the next check retries.
 */
@Injectable()
export class LogRetentionSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(LogRetentionSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly logs: LogsService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.pass('boot');
    this.timer = setInterval(() => void this.checkInterval(), 3_600_000);
  }

  private async checkInterval(): Promise<void> {
    try {
      if (await this.logs.intervalElapsed()) await this.pass('interval');
    } catch (error: unknown) {
      this.log.warn(`Interval check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async pass(origin: 'boot' | 'interval'): Promise<void> {
    try {
      const run = await this.logs.purge(origin);
      if (run.files > 0) this.log.log(`Retention (${origin}): ${run.files} file(s), ${run.bytes} bytes freed`);
    } catch (error: unknown) {
      this.log.warn(`Retention (${origin}) skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
