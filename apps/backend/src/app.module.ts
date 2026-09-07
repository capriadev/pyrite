import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DalModule } from './dal/dal.module';
import { RedisModule } from './dal/redis.module';
import { BllModule } from './bll/bll.module';
import { GatewayModule } from './gateway/gateway.module';
import { ServicesModule } from './services/services.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { CryptoModule } from './crypto/crypto.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule, DalModule, RedisModule, ServicesModule, BllModule,
    GatewayModule, IntegrationsModule, CryptoModule, AuthModule,
  ],
})
export class AppModule {}
