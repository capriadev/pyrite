import { Global, Module } from '@nestjs/common';
import { DalModule } from '../dal/dal.module';

/**
 * Domain logic layer. Feature BLL modules are registered here as they are
 * built; it must never import from gateway/ or integrations/.
 */
@Global()
@Module({
  imports: [DalModule],
})
export class BllModule {}
