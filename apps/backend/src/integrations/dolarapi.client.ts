import { Injectable } from '@nestjs/common';

export interface DolarApiRate {
  casa: string;
  compra: number;
  venta: number;
  nombre: string;
  moneda: string;
  fechaActualizacion: string;
}

@Injectable()
export class DolarApiClient {
  async fetchAll(): Promise<DolarApiRate[]> {
    const res = await fetch('https://dolarapi.com/v1/dolares');
    if (!res.ok) throw new Error(`DolarApi returned ${res.status}`);
    return res.json() as Promise<DolarApiRate[]>;
  }
}