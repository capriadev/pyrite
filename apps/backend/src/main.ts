import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { appConfig } from './config/configuration';
import { LoggerService, HttpLoggingInterceptor } from './services/logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(LoggerService);
  await logger.init();
  app.useLogger(logger);
  app.useGlobalInterceptors(new HttpLoggingInterceptor());
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().on('close', () => logger.close());
  await app.listen(appConfig.port);
  logger.log(`Pyrite backend listening on http://localhost:${appConfig.port}`, 'Bootstrap');
}

void bootstrap();

