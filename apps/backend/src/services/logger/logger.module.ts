import { Module, Global } from '@nestjs/common';
import { LoggerService } from './logger.service';

/**
 * Exposes the shared LoggerService. The logger is registered globally in
 * main.ts (app.useLogger) so every Nest Logger call flows through it without
 * touching individual services.
 */
@Global()
@Module({
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
