import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SettingsController } from './settings.controller';
import { FinancesController } from './finances.controller';
import { RatesController } from './rates.controller';
import { ApiKeysController } from './api-keys.controller';
import { ServicesModule } from '../services/services.module';
import { BllModule } from '../bll/bll.module';

@Module({
  imports: [ServicesModule, BllModule],
  controllers: [HealthController, SettingsController, FinancesController, RatesController, ApiKeysController],
})
export class GatewayModule {}
