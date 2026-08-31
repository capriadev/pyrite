import { Global, Module } from '@nestjs/common';
import { appConfigProvider } from './configuration';

@Global()
@Module({
  providers: [appConfigProvider],
  exports: [appConfigProvider],
})
export class ConfigModule {}
