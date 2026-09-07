import { Injectable } from '@nestjs/common';

export interface ArgentinaDatosRow {
  casa: string;
  compra: number;
  venta: number;
  fecha: string;
}

@Injectable()
export class ArgentinaDatosClient {
  async fetchFullSeries(): Promise<ArgentinaDatosRow[]> {
    const res = await fetch('https://api.argentinadatos.com/v1/cotizaciones/dolares');
    if (!res.ok) throw new Error(`ArgentinaDatos returned ${res.status}`);
    return res.json() as Promise<ArgentinaDatosRow[]>;
  }
}