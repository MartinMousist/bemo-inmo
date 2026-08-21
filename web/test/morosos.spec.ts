import { describe, expect, it } from 'vitest';
import { agruparMorosos, type CuotaImpaga } from '../src/dominio/morosos';

const cuota = (p: Partial<CuotaImpaga>): CuotaImpaga => ({
  contratoId: 'c1',
  etiquetaPropiedad: 'PROP-0001',
  referencia: 'Cuota 03/2026',
  inquilino: 'Camila Rossi',
  saldo: 553000,
  moneda: 'ARS',
  diasDeMora: 30,
  venceEl: '2026-03-10',
  ...p,
});

describe('Agrupar cuotas impagas por contrato', () => {
  it('cinco cuotas del mismo inquilino son UNA fila con el total', () => {
    const r = agruparMorosos([
      cuota({ diasDeMora: 164, venceEl: '2026-03-10' }),
      cuota({ diasDeMora: 133, venceEl: '2026-04-10' }),
      cuota({ diasDeMora: 103, venceEl: '2026-05-10' }),
      cuota({ diasDeMora: 72, venceEl: '2026-06-10' }),
      cuota({ diasDeMora: 42, venceEl: '2026-07-10' }),
    ]);

    expect(r).toHaveLength(1);
    expect(r[0].cuotas).toBe(5);
    expect(r[0].saldo).toBe(553000 * 5);
    expect(r[0].quien).toBe('Camila Rossi');
  });

  it('la mora y la fecha son las de la cuota MÁS VIEJA', () => {
    // «Debe desde marzo» dice qué tan grave es. «Debe hasta julio» no dice nada:
    // la última siempre es la del mes pasado.
    const r = agruparMorosos([
      cuota({ diasDeMora: 42, venceEl: '2026-07-10' }),
      cuota({ diasDeMora: 164, venceEl: '2026-03-10' }),
      cuota({ diasDeMora: 103, venceEl: '2026-05-10' }),
    ]);

    expect(r[0].diasDeMora).toBe(164);
    expect(r[0].venceEl).toBe('2026-03-10');
  });

  /**
   * El caso que justifica que la clave lleve la moneda.
   *
   * Sumar pesos con dólares da un número que no es plata de nada. Son dos
   * deudas distintas y se cobran por separado.
   */
  it('un contrato con cuotas en dos monedas da DOS filas, sin sumarlas', () => {
    const r = agruparMorosos([
      cuota({ saldo: 553000, moneda: 'ARS' }),
      cuota({ saldo: 1200, moneda: 'USD' }),
    ]);

    expect(r).toHaveLength(2);
    expect(r.find((m) => m.moneda === 'ARS')!.saldo).toBe(553000);
    expect(r.find((m) => m.moneda === 'USD')!.saldo).toBe(1200);
  });

  it('ordena por mora: primero al que hay que llamar hoy', () => {
    const r = agruparMorosos([
      cuota({ contratoId: 'c1', diasDeMora: 42 }),
      cuota({ contratoId: 'c2', diasDeMora: 164, inquilino: 'Bar Don Genaro' }),
      cuota({ contratoId: 'c3', diasDeMora: 90, inquilino: 'Otro' }),
    ]);

    expect(r.map((m) => m.diasDeMora)).toEqual([164, 90, 42]);
  });

  it('sin inquilino cargado usa la referencia de la cuota', () => {
    const r = agruparMorosos([cuota({ inquilino: null, referencia: 'Cuota 03/2026' })]);
    expect(r[0].quien).toBe('Cuota 03/2026');
  });

  it('sin cuotas no inventa filas', () => {
    expect(agruparMorosos([])).toEqual([]);
  });
});
