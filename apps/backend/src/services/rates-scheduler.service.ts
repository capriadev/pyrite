import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { RatesService } from '../bll/rates/rates.service';

/**
 * Scheduler for rate sync operations.
 * - Sync al boot (reconciliación completa desde ArgentinaDatos).
 * - Cada hora en punto: refresh intradia desde dolarapi.
 * - Si >6h desde último reconcile completo: lo dispara (gap-fill automático).
 * - 1 vez al día: cross-check (dolarapi vs ArgentinaDatos para desfase).
 */
@Injectable()
export class RatesSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(RatesSchedulerService.name);
  private timers: Array<ReturnType<typeof setInterval | typeof setTimeout>> = [];

  constructor(private readonly rates: RatesService) {}

  async onApplicationBootstrap(): Promise<void> {
    // 1. Sync completo al boot
    this.log.log('Boot: running initial reconcile (ArgentinaDatos)...');
    try {
      await this.rates.reconcileFull();
      await this.rates.refreshIntradia();
      this.log.log('Boot: reconcile complete.');
    } catch (err: unknown) {
      this.log.warn(`Boot reconcile failed: ${err instanceof Error ? err.message : err}`);
    }

    // 2. Alinear a la próxima hora en punto
    msUntilNextHour().then((ms) => {
      this.log.log(`Scheduler: waiting ${Math.round(ms / 1000)}s until next hour`);
      const t = setTimeout(() => {
        this.runHourly();
        this.startHourlyInterval();
      }, ms);
      this.timers.push(t);
    });
  }

  private startHourlyInterval(): void {
    const t = setInterval(() => this.runHourly(), 3600_000);
    this.timers.push(t);
  }

  private async runHourly(): Promise<void> {
    // Refresco intradia + reconcile cada >6hs
    this.log.log('Scheduler: hourly tick');
    await this.rates.refreshIntradia().catch((e: unknown) => this.log.warn(`Intradia error: ${e}`));
    await this.rates.hourlyTick().catch((e: unknown) => this.log.warn(`Hourly tick error: ${e}`));
  }

  onApplicationShutdown(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.forEach((t) => clearInterval(t));
  }
}

async function msUntilNextHour(): Promise<number> {
  const now = Date.now();
  const next = Math.ceil(now / 3600_000) * 3600_000;
  return next - now;
}