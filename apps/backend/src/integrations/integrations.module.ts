import { Global, Module } from '@nestjs/common';
import { ArgentinaDatosClient } from './argentinadatos.client';
import { DolarApiClient } from './dolarapi.client';

/**
 * External services are consumed over HTTP/CLI here. Their code is never
 * imported into the core (see architecture.md).
 */
@Global()
@Module({
  providers: [ArgentinaDatosClient, DolarApiClient],
  exports: [ArgentinaDatosClient, DolarApiClient],
})
export class IntegrationsModule {}
