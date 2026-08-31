import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { appConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(appConfig.port);
  console.log(`Pyrite backend listening on http://localhost:${appConfig.port}`);
}

void bootstrap();
