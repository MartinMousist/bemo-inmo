import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarVista, leerVista, VISTA_POR_DEFECTO } from '../src/dominio/vista';

const CLAVE = 'bemo-inmo:vista:propiedades';

/**
 * La preferencia de vista tabla ⇄ tarjetas.
 *
 * No se prueba «guarda y lee» y nada más: eso lo cumpliría también una versión
 * que deja la pantalla en blanco con un valor viejo o que explota en Safari
 * privado. Lo que se prueba son las dos reglas que `filtros.ts` ya tenía y que
 * este módulo copia por número.
 */
describe('leerVista / guardarVista', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('sin nada guardado arranca en TABLA', () => {
    // La tabla es el default y no se va: DESIGN.md §1 —«la densidad es una
    // virtud»—. Las tarjetas son la segunda vista, no el reemplazo.
    expect(leerVista()).toBe('tabla');
    expect(VISTA_POR_DEFECTO).toBe('tabla');
  });

  it('recuerda lo elegido', () => {
    guardarVista('tarjetas');
    expect(leerVista()).toBe('tarjetas');
    expect(localStorage.getItem(CLAVE)).toBe('tarjetas');
  });

  it('regla 2 · un valor guardado que ya no es válido cae al default', () => {
    // Si mañana se renombra `tarjetas`, un localStorage viejo dejaría la
    // pantalla sin ninguna de las dos vistas: ni tabla ni grilla, o sea en
    // blanco. Y el usuario no eligió nada raro: eligió una vista que existía.
    localStorage.setItem(CLAVE, 'mosaico');
    expect(leerVista()).toBe('tabla');
  });

  it('regla 3 · un localStorage que explota no rompe la pantalla', () => {
    // En modo privado de Safari, leer y escribir pueden tirar excepción. Una
    // vista que no se recuerda es una molestia; una pantalla en blanco es un
    // bug.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => leerVista()).not.toThrow();
    expect(leerVista()).toBe('tabla');

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => guardarVista('tarjetas')).not.toThrow();
  });

  it('la clave es UNA para las tres pantallas de propiedades', () => {
    // Propiedades, la cartera de venta y la de alquiler son el mismo objeto
    // visto de tres maneras. Una clave por pantalla haría que la vista se dé
    // vuelta al pasar de una a otra.
    guardarVista('tarjetas');
    expect(Object.keys(localStorage)).toEqual([CLAVE]);
  });
});
