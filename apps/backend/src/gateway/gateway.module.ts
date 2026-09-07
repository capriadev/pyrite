import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SettingsController } from './settings.controller';
import { FinancesController } from './finances.controller';
import { RatesController } from './rates.controller';
import { ServicesModule } from '../services/services.module';
import { BllModule } from '../bll/bll.module';

@Module({
  imports: [ServicesModule, BllModule],
  controllers: [HealthController, SettingsController, FinancesController, RatesController],
})
export class GatewayModule {}
