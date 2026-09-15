import { Global, Module } from '@nestjs/common';
import { DalModule } from '../../dal/dal.module';
import { CryptoService } from './crypto.service';
import { SectionKeysService } from './section-keys';

@Global()
@Module({
  imports: [DalModule],
  providers: [CryptoService, SectionKeysService],
  exports: [CryptoService, SectionKeysService],
})
export class CryptoModule {}