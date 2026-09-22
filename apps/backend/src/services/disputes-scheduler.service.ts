import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { DisputesService } from '../bll/disputes/disputes.service';

/**
 * Scheduler of the dispute engine (spec 019). Same shape as the rates scheduler:
 * - one pass at boot, so a restart catches up with what happened while the app was off;
 * - one pass every night (aligned to the next 3am), which is when the day is over and the
 *   payments of the day are already recorded;
 * - the manual `POST /disputes/run` stays available for anyone who does not want to wait.
 *
 * A parked engine (`disputes.enabled` false) answers 409 on the manual run and logs a skip
 * here; nothing else changes, because the passes are the only thing the switch controls.
 */
@Injectable()
export class DisputesSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(DisputesSchedulerService.name);
  private timers: Array<ReturnType<typeof setInterval | typeof setTimeout>> = [];

  constructor(private readonly disputes: DisputesService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.pass('boot');
    const ms = msUntilNextNight();
    const t = setTimeout(() => {
      void this.pass('nightly').then(() => this.startNightlyInterval());
    }, ms);
    this.timers.push(t);
    this.log.log(`Scheduler: next pass in ${Math.round(ms / 60000)} min`);
  }

  private startNightlyInterval(): void {
    const t = setInterval(() => void this.pass('nightly'), 86_400_000);
    this.timers.push(t);
  }

  /** A failing pass never brings the app down: it is logged and the next one retries. */
  private async pass(origin: string): Promise<void> {
    try {
      const result = await this.disputes.run();
      this.log.log(`Pass (${origin}): ${result.settled} settled, ${result.missing} missing, ${result.unplanned} unplanned`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`Pass (${origin}) skipped: ${message}`);
    }
  }

  onApplicationShutdown(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.forEach((t) => clearInterval(t));
  }
}

/** Milliseconds to the next 3am local time. */
function msUntilNextNight(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}
