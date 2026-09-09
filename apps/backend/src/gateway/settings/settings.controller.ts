import { Controller, Get, Param, Put, Body } from '@nestjs/common';
import { SettingsService } from '../../bll/settings/settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  list(): Array<{ key: string; value: unknown }> {
    return this.settings.all();
  }

  @Get(':key')
  get(@Param('key') key: string): unknown {
    return this.settings.get(key);
  }

  @Put(':key')
  async set(@Param('key') key: string, @Body() body: { value: unknown }): Promise<{ key: string; value: unknown }> {
    return this.settings.set(key, body.value);
  }
}