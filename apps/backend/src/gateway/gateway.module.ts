import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { SettingsController } from './settings/settings.controller';
import { FinancesController } from './finances/finances.controller';
import { RatesController } from './rates/rates.controller';
import { ApiKeysController } from './apis/api-keys.controller';
import { AuthModule } from './auth/auth.module';
import { ServicesModule } from '../services/services.module';
import { BllModule } from '../bll/bll.module';

@Module({
  imports: [ServicesModule, BllModule, AuthModule],
  controllers: [HealthController, SettingsController, FinancesController, RatesController, ApiKeysController],
})
export class GatewayModule {}
