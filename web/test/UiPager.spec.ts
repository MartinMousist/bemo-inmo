import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import UiPager from '../src/componentes/UiPager.vue';

/**
 * El paginador.
 *
 * Se prueba porque **ya tuvo un bug**: el compilador de plantillas se comía el
 * espacio antes del sustantivo y decía "de 12contratos". Es el tipo de cosa que
 * sólo se ve mirando la pantalla… hasta que hay un test.
 */
describe('UiPager', () => {
  const montar = (props: Record<string, unknown>) =>
    mount(UiPager, { props: { pagina: 1, paginas: 1, total: 0, porPagina: 25, ...props } });

  it('muestra el rango real, no sólo "página X de Y"', () => {
    // Saber cuántos registros hay y cuáles se están mirando es parte del dato:
    // es la diferencia entre "vi todas las liquidaciones" y "vi las primeras 25".
    const w = montar({ pagina: 2, paginas: 13, total: 312, porPagina: 25 });
    expect(w.text()).toContain('26–50 de 312');
  });

  it('no se come el espacio antes del sustantivo', () => {
    const w = montar({ pagina: 1, paginas: 1, total: 12, porPagina: 25, sustantivo: 'contratos' });
    expect(w.text()).toContain('de 12');
    expect(w.text()).toMatch(/12\s+contratos/);
    expect(w.text()).not.toContain('12contratos');
  });

  it('la última página no promete filas que no existen', () => {
    // 312 registros de a 25: la página 13 tiene 12, no 25.
    const w = montar({ pagina: 13, paginas: 13, total: 312, porPagina: 25 });
    expect(w.text()).toContain('301–312 de 312');
  });

  it('sin resultados no se muestra: un "0–0 de 0" es ruido', () => {
    const w = montar({ total: 0 });
    expect(w.find('.pager').exists()).toBe(false);
  });

  it('con una sola página no hay botones, pero sí el total', () => {
    const w = montar({ pagina: 1, paginas: 1, total: 8, porPagina: 25 });
    expect(w.text()).toContain('1–8 de 8');
    expect(w.findAll('button')).toHaveLength(0);
  });

  it('los botones de los extremos se deshabilitan, no desaparecen', () => {
    // Un control que aparece y desaparece hace saltar el layout.
    const primera = montar({ pagina: 1, paginas: 5, total: 120, porPagina: 25 });
    const botones = primera.findAll('button');
    expect(botones).toHaveLength(2);
    expect(botones[0].attributes('disabled')).toBeDefined();
    expect(botones[1].attributes('disabled')).toBeUndefined();

    const ultima = montar({ pagina: 5, paginas: 5, total: 120, porPagina: 25 });
    expect(ultima.findAll('button')[1].attributes('disabled')).toBeDefined();
  });

  it('emite la página nueva en vez de mutarla', () => {
    const w = montar({ pagina: 2, paginas: 5, total: 120, porPagina: 25 });
    const [anterior, siguiente] = w.findAll('button');

    siguiente.trigger('click');
    anterior.trigger('click');

    expect(w.emitted('update:pagina')).toEqual([[3], [1]]);
  });
});
