import { Module } from '@nestjs/common';

/**
 * External services are consumed over HTTP/CLI here. Their code is never
 * imported into the core (see architecture.md).
 */
@Module({})
export class IntegrationsModule {}
