import { Controller, Get, Post, Query } from '@nestjs/common';
import { RatesService, type RateEntry } from '../bll/rates.service';

@Controller('rates')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Get('latest')
  async latest(@Query('type') type = 'blue'): Promise<RateEntry | undefined> {
    return this.rates.getLatest(type);
  }

  @Get('series')
  async series(
    @Query('type') type = 'blue',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<RateEntry[]> {
    return this.rates.getSeries(type, from, to);
  }

  @Post('sync')
  async sync(): Promise<{ ok: boolean; count: number }> {
    const count = await this.rates.reconcileFull();
    await this.rates.refreshIntradia();
    return { ok: true, count };
  }
}