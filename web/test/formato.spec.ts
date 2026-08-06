import { describe, expect, it } from 'vitest';
import {
  fecha,
  money,
  moneyCorto,
  numero,
  periodo,
  proximidad,
  plural,
} from '../src/dominio/formato';

/**
 * `dominio/formato.ts` no es cosmética: son reglas de negocio.
 *
 * Se prueba primero porque es el módulo que **ya tuvo un bug** —de zona
 * horaria— y porque un error acá se ve en todas las pantallas a la vez y en
 * ninguna se ve como un error: un contrato que empieza el 1 mostrado como 31 del
 * mes anterior parece un dato mal cargado, no un formateo mal hecho.
 */

describe('money', () => {
  it('nunca muestra un monto sin su moneda', () => {
    // Es la regla dura de DESIGN.md: ARS y USD conviven en la misma tabla, y un
    // "$" ambiguo acá es un error de plata, no de diseño.
    expect(money(450000, 'ARS')).toBe('ARS 450.000,00');
    expect(money(92000, 'USD')).toBe('USD 92.000,00');
    expect(money(450000, 'ARS')).not.toContain('$');
  });

  it('usa el formato es-AR: miles con punto, decimales con coma', () => {
    expect(money(1234567.89, 'ARS')).toBe('ARS 1.234.567,89');
    expect(money(1234567.89, 'ARS')).not.toContain('1,234,567.89');
  });

  it('siempre muestra los dos decimales', () => {
    // En una columna de plata, "450.000" y "450.000,00" desalinean y hacen
    // dudar de si falta un dato.
    expect(money(450000, 'ARS')).toBe('ARS 450.000,00');
    expect(money(0.5, 'ARS')).toBe('ARS 0,50');
  });

  it('un valor ausente es un guión, no un cero', () => {
    // Un cero es un número, y en una pantalla de plata dice algo distinto de
    // "no hay dato".
    expect(money(null, 'ARS')).toBe('—');
    expect(money(undefined, 'ARS')).toBe('—');
    expect(money(0, 'ARS')).toBe('ARS 0,00');
  });

  it('los negativos conservan el signo', () => {
    expect(money(-1500, 'ARS')).toContain('1.500,00');
    expect(money(-1500, 'ARS')).toContain('-');
  });

  it('moneyCorto saca los centavos pero nunca la moneda', () => {
    expect(moneyCorto(485000.75, 'ARS')).toBe('ARS 485.001');
    expect(moneyCorto(null, 'USD')).toBe('—');
  });
});

describe('fecha', () => {
  it('usa dd/mm/aaaa, nunca formato US', () => {
    expect(fecha('2026-03-07')).toBe('07/03/2026');
    expect(fecha('2026-12-25')).toBe('25/12/2026');
  });

  it('NO se corre un día por zona horaria', () => {
    // Éste es el bug que este proyecto ya tuvo. `new Date('2026-01-01')` es
    // medianoche UTC; en Argentina (UTC-3) eso es el 31/12/2025 a las 21:00.
    // Un contrato que empieza el 1 pasaba a empezar el 31 del mes anterior.
    expect(fecha('2026-01-01')).toBe('01/01/2026');
    expect(fecha('2026-01-01T00:00:00.000Z')).toBe('01/01/2026');
    expect(fecha('2025-12-31')).toBe('31/12/2025');
  });

  it('rellena con cero a la izquierda', () => {
    // Sin esto, una columna de fechas queda desalineada.
    expect(fecha('2026-01-05')).toBe('05/01/2026');
    expect(fecha('2026-01-05')).not.toBe('5/1/2026');
  });

  it('lo vacío o inválido es un guión, no "Invalid Date"', () => {
    expect(fecha(null)).toBe('—');
    expect(fecha(undefined)).toBe('—');
    expect(fecha('')).toBe('—');
    expect(fecha('no es una fecha')).toBe('—');
  });
});

describe('periodo', () => {
  it('se lee como mes/año corto', () => {
    expect(periodo('2025-11-01')).toBe('nov/25');
    expect(periodo('2026-01-01')).toBe('ene/26');
  });

  it('tampoco se corre por zona', () => {
    // El 1 de enero es el período de enero, no el de diciembre.
    expect(periodo('2026-01-01')).toBe('ene/26');
    expect(periodo('2025-12-01')).toBe('dic/25');
  });

  it('lo vacío es un guión', () => {
    expect(periodo(null)).toBe('—');
  });
});

describe('proximidad', () => {
  /** Una fecha a N días de hoy, en hora local. */
  function enDias(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  }

  it('usa el semáforo de DESIGN.md: >30d neutro, 30-8d warn, ≤7d err', () => {
    expect(proximidad(enDias(60)).tono).toBe('neutro');
    expect(proximidad(enDias(20)).tono).toBe('warn');
    expect(proximidad(enDias(5)).tono).toBe('err');
  });

  it('hoy vence, no está vencido', () => {
    // La diferencia importa: el día de vencimiento es el último día para pagar.
    const hoy = proximidad(enDias(0));
    expect(hoy.dias).toBe(0);
    expect(hoy.tono).toBe('err');
    expect(hoy.texto).toBe('Vence hoy');
  });

  it('lo vencido dice hace cuánto', () => {
    const r = proximidad(enDias(-12));
    expect(r.tono).toBe('vencido');
    expect(r.texto).toContain('12');
  });

  it('el borde de los 7 y los 30 días cae del lado correcto', () => {
    // Los bordes son donde estos semáforos se equivocan siempre.
    expect(proximidad(enDias(7)).tono).toBe('err');
    expect(proximidad(enDias(8)).tono).toBe('warn');
    expect(proximidad(enDias(30)).tono).toBe('warn');
    expect(proximidad(enDias(31)).tono).toBe('neutro');
  });

  it('sin fecha no inventa un estado', () => {
    expect(proximidad(null)).toEqual({ dias: null, tono: 'neutro', texto: '—' });
  });
});

describe('numero', () => {
  it('agrupa los miles y no muestra decimales', () => {
    expect(numero(1234567)).toBe('1.234.567');
    expect(numero(78, ' m²')).toBe('78 m²');
  });

  it('distingue el cero de la ausencia', () => {
    expect(numero(0)).toBe('0');
    expect(numero(null)).toBe('—');
  });
});

/**
 * `plural`.
 *
 * Existe para terminar con las 85 apariciones de `(s)` y `(es)` que había
 * repartidas por el producto. Los casos de acá son los que el paréntesis NO
 * resolvía: el plural de «liquidación» no es «liquidación(es)».
 */
describe('plural', () => {
  it('elige la forma según la cantidad', () => {
    expect(plural(1, 'contrato', 'contratos')).toBe('1 contrato');
    expect(plural(2, 'contrato', 'contratos')).toBe('2 contratos');
  });

  it('cero va en plural, como en castellano', () => {
    expect(plural(0, 'contrato', 'contratos')).toBe('0 contratos');
  });

  it('resuelve los plurales que el paréntesis rompía', () => {
    // «liquidación(es)» no existe: al pluralizar se pierde la tilde.
    expect(plural(2, 'liquidación', 'liquidaciones')).toBe('2 liquidaciones');
    expect(plural(1, 'liquidación', 'liquidaciones')).toBe('1 liquidación');
  });

  it('formatea el número con separador de miles', () => {
    expect(plural(1200, 'fila', 'filas')).toBe('1.200 filas');
  });

  it('sin número devuelve sólo el sustantivo', () => {
    // Para cuando la cifra ya está en pantalla en grande y repetirla es ruido.
    expect(plural(3, 'propiedad', 'propiedades', false)).toBe('propiedades');
    expect(plural(1, 'propiedad', 'propiedades', false)).toBe('propiedad');
  });

  it('null y undefined se tratan como cero, no revientan', () => {
    expect(plural(null, 'gasto', 'gastos')).toBe('0 gastos');
    expect(plural(undefined, 'gasto', 'gastos')).toBe('0 gastos');
  });
});
