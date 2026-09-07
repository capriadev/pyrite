import { Injectable, Logger } from '@nestjs/common';
import { ArgentinaDatosClient } from '../integrations/argentinadatos.client';
import { DolarApiClient, type DolarApiRate } from '../integrations/dolarapi.client';
import { RatesRepository } from '../dal/rates.repository';

export interface RateEntry {
  type: string;
  buy: number;
  sell: number;
  date: string;
}

@Injectable()
export class RatesService {
  private readonly log = new Logger(RatesService.name);
  private intradiaRates: DolarApiRate[] | null = null;

  constructor(
    private readonly argData: ArgentinaDatosClient,
    private readonly dolarApi: DolarApiClient,
    private readonly ratesRepo: RatesRepository,
  ) {}

  async reconcileFull(): Promise<number> {
    const rows = await this.argData.fetchFullSeries();
    const entries = rows
      .filter((r) => r.casa && r.venta != null && r.compra != null)
      .map((r) => ({ type: r.casa, buy: r.compra, sell: r.venta, date: r.fecha }));
    await this.ratesRepo.upsertMany(entries);
    this.log.log(`Reconcile complete: ${entries.length} entries`);
    return entries.length;
  }

  async refreshIntradia(): Promise<void> {
    this.intradiaRates = await this.dolarApi.fetchAll();
  }

  async getLatest(type: string): Promise<RateEntry | undefined> {
    if (this.intradiaRates) {
      const intradia = this.intradiaRates.find((r) => r.casa === type);
      if (intradia) return { type, buy: intradia.compra, sell: intradia.venta, date: new Date().toISOString().slice(0, 10) };
    }
    const row = await this.ratesRepo.getLatest(type);
    return row ? { ...row, type } : undefined;
  }

  async getSeries(type: string, from?: string, to?: string): Promise<RateEntry[]> {
    const rows = await this.ratesRepo.getSeries(type, from, to);
    return rows.map((r) => ({ ...r, type }));
  }

  async dailyCrossCheck(): Promise<void> {
    const lastBlue = await this.ratesRepo.getLastDate('blue');
    if (!lastBlue) {
      this.log.warn('Daily check: no blue data at all');
      return;
    }
    const daysBehind = (Date.now() - new Date(lastBlue).getTime()) / 86_400_000;
    if (daysBehind > 2) this.log.warn(`Blue ${Math.floor(daysBehind)} days behind (last=${lastBlue})`);
  }
}
