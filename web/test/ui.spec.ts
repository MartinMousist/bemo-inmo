import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../src/stores/ui';
import { consulta, paginaVacia } from '../src/dominio/pagina';

describe('store de UI', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('el toast lleva detalle, que es el punto', () => {
    // "Guardado" no sirve; "Cobro registrado · ARS 485.000" es lo que permite
    // ver un cero de más en el momento y no a fin de mes.
    const ui = useUi();
    ui.ok('Cobro registrado', 'ARS 485.000,00');

    expect(ui.toasts).toHaveLength(1);
    expect(ui.toasts[0].titulo).toBe('Cobro registrado');
    expect(ui.toasts[0].detalle).toBe('ARS 485.000,00');
    expect(ui.toasts[0].tono).toBe('ok');
  });

  it('se cierra solo, y el de error dura más', () => {
    const ui = useUi();
    ui.ok('Listo');
    ui.error('Falló');

    vi.advanceTimersByTime(4100);
    // El de éxito ya se fue; el de error sigue, porque suele haber algo que leer.
    expect(ui.toasts.map((t) => t.tono)).toEqual(['err']);

    vi.advanceTimersByTime(4100);
    expect(ui.toasts).toHaveLength(0);
  });

  it('cerrarlo a mano dos veces no rompe nada', () => {
    // El timer sigue corriendo después de cerrar a mano: `cerrarToast` tiene que
    // ser idempotente o el segundo intento tira.
    const ui = useUi();
    const id = ui.ok('Listo');
    ui.cerrarToast(id);
    ui.cerrarToast(id);
    vi.advanceTimersByTime(5000);
    expect(ui.toasts).toHaveLength(0);
  });

  it('cada toast tiene un id propio', () => {
    const ui = useUi();
    const a = ui.ok('Uno');
    const b = ui.ok('Dos');
    expect(a).not.toBe(b);

    ui.cerrarToast(a);
    expect(ui.toasts).toHaveLength(1);
    expect(ui.toasts[0].titulo).toBe('Dos');
  });

  describe('confirmar', () => {
    it('resuelve true al aceptar y false al cancelar', async () => {
      const ui = useUi();

      const aceptada = ui.confirmar({ titulo: '¿Borrar?' });
      expect(ui.confirmacion?.titulo).toBe('¿Borrar?');
      ui.responder(true);
      await expect(aceptada).resolves.toBe(true);
      expect(ui.confirmacion).toBeNull();

      const cancelada = ui.confirmar({ titulo: '¿Borrar?' });
      ui.responder(false);
      await expect(cancelada).resolves.toBe(false);
    });

    it('una confirmación nueva resuelve la anterior en FALSE', async () => {
      // Dejarla colgada filtraría una promesa que nunca se cumple, y el código
      // que la esperaba quedaría trabado para siempre.
      const ui = useUi();

      const primera = ui.confirmar({ titulo: 'Primera' });
      const segunda = ui.confirmar({ titulo: 'Segunda' });

      await expect(primera).resolves.toBe(false);
      expect(ui.confirmacion?.titulo).toBe('Segunda');

      ui.responder(true);
      await expect(segunda).resolves.toBe(true);
    });

    it('responder sin nada abierto no explota', () => {
      const ui = useUi();
      expect(() => ui.responder(true)).not.toThrow();
    });
  });
});

describe('armado del query string', () => {
  it('omite los filtros vacíos', () => {
    // El backend valida con `@IsIn(...)`: una cadena vacía es un 400, no
    // "sin filtro". Mandarla convierte un filtro limpio en un error.
    const q = consulta({ pagina: 2, porPagina: 25 }, { estado: '', q: 'san martín' });
    const p = new URLSearchParams(q);

    expect(p.get('pagina')).toBe('2');
    expect(p.get('porPagina')).toBe('25');
    expect(p.get('q')).toBe('san martín');
    expect(p.has('estado')).toBe(false);
  });

  it('omite null y undefined, pero NO el false ni el cero', () => {
    // `futuros=false` es un filtro con significado; omitirlo cambia el
    // resultado.
    const p = new URLSearchParams(
      consulta({ pagina: 1, porPagina: 10 }, {
        a: null, b: undefined, futuros: false, dias: 0,
      }),
    );
    expect(p.has('a')).toBe(false);
    expect(p.has('b')).toBe(false);
    expect(p.get('futuros')).toBe('false');
    expect(p.get('dias')).toBe('0');
  });

  it('escapa lo que haría falta escapar', () => {
    const p = new URLSearchParams(
      consulta({ pagina: 1, porPagina: 10 }, { q: 'a&b=c d' }),
    );
    expect(p.get('q')).toBe('a&b=c d');
  });
});

describe('paginaVacia', () => {
  it('no miente: cero items, cero total, una página', () => {
    expect(paginaVacia(50)).toEqual({
      items: [], total: 0, pagina: 1, porPagina: 50, paginas: 1,
    });
  });
});
