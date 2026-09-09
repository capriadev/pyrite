import { Global, Module } from '@nestjs/common';
import { DalModule } from '../dal/dal.module';
import { SettingsService } from './settings/settings.service';
import { FinancesService } from './finances/finances.service';
import { RatesService } from './rates/rates.service';
import { ApiKeysService } from './apis/api-keys.service';

/**
 * Domain logic layer. Feature BLL modules are registered here as they are
 * built; it must never import from gateway/ or integrations/.
 */
@Global()
@Module({
  imports: [DalModule],
  providers: [SettingsService, FinancesService, RatesService, ApiKeysService],
  exports: [SettingsService, FinancesService, RatesService, ApiKeysService],
})
export class BllModule {}
