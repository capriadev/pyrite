import { Global, Module } from '@nestjs/common';
import { DalModule } from '../dal/dal.module';
import { SettingsService } from './settings.service';
import { FinancesService } from './finances.service';

/**
 * Domain logic layer. Feature BLL modules are registered here as they are
 * built; it must never import from gateway/ or integrations/.
 */
@Global()
@Module({
  imports: [DalModule],
  providers: [SettingsService, FinancesService],
  exports: [SettingsService, FinancesService],
})
export class BllModule {}
