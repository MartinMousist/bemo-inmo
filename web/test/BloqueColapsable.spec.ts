import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import BloqueColapsable from '../src/componentes/BloqueColapsable.vue';

/**
 * El colapsable de la ficha.
 *
 * Tres cosas que se prueban y una que se prueba **al revés de lo intuitivo**:
 *
 * · El `aria` tiene que ser cierto, no estar puesto: `aria-controls` que apunta
 *   a un id que no existe es peor que no tenerlo, porque el lector de pantalla
 *   anuncia un control que no lleva a ningún lado.
 * · Cerrado y nunca abierto **no monta**: es todo el punto del ahorro, y si
 *   alguien cambia el `v-if` por un `v-show` la ficha vuelve a hacer once
 *   requests sin que nada se vea distinto.
 * · Cerrar después **NO desmonta**. Es lo contrario de lo que uno escribiría, y
 *   sin un test que lo fije, el primer "simplifiquemos esto a un v-if" se lleva
 *   puesto el borrador de WhatsApp de GarantesContrato y el textarea a medio
 *   editar de PanelDocumentos.
 */

/** Un hijo que cuenta sus montajes y guarda algo que se puede perder. */
const Adentro = defineComponent({
  name: 'Adentro',
  setup() {
    montajes++;
    const borrador = ref('lo que alguien estaba escribiendo');
    return () => h('textarea', { class: 'borrador', value: borrador.value });
  },
});

let montajes = 0;

const montar = (abierto: boolean) => {
  montajes = 0;
  return mount(BloqueColapsable, {
    props: { id: 'cuotas', titulo: 'Cuotas', abierto },
    slots: {
      default: () => h(Adentro),
      resumen: () => h('span', { class: 'chip-falso' }, '3 impagas · ARS 1.543.000'),
    },
    global: { stubs: { UiIcon: true } },
  });
};

describe('BloqueColapsable · el aria dice la verdad', () => {
  it('aria-expanded sigue al estado y aria-controls apunta al region que existe', async () => {
    const w = montar(false);
    const boton = w.find('button');

    expect(boton.attributes('aria-expanded')).toBe('false');

    const panelId = boton.attributes('aria-controls')!;
    const region = w.find(`#${panelId}`);
    // El destino existe de verdad: un aria-controls colgando anuncia un control
    // que no lleva a ningún lado.
    expect(region.exists()).toBe(true);
    expect(region.attributes('role')).toBe('region');
    expect(region.attributes('hidden')).toBeDefined();

    // Y el region está rotulado por el título, no por un texto suelto.
    expect(region.attributes('aria-labelledby')).toBe(w.find('h2').attributes('id'));
    expect(w.find('h2').text()).toContain('Cuotas');

    await w.setProps({ abierto: true });
    expect(w.find('button').attributes('aria-expanded')).toBe('true');
    expect(w.find(`#${panelId}`).attributes('hidden')).toBeUndefined();
  });

  it('el disparador es un <button type="button"> — Enter y Espacio salen gratis', () => {
    const w = montar(false);
    const boton = w.find('button');
    // `type="button"` importa: adentro de un <form> un botón sin type envía.
    expect(boton.attributes('type')).toBe('button');
  });

  it('el clic pide el cambio, no lo hace solo: el estado vive en la preferencia', async () => {
    const w = montar(false);
    await w.find('button').trigger('click');

    expect(w.emitted('update:abierto')).toEqual([[true]]);
    // No se auto-abrió: sigue cerrado hasta que el padre lo diga.
    expect(w.find('button').attributes('aria-expanded')).toBe('false');
  });

  it('el resumen vive FUERA del botón: adentro sería HTML inválido y un clic que miente', () => {
    const w = montar(false);
    const boton = w.find('button');

    expect(w.find('.chip-falso').exists()).toBe(true);
    expect(boton.find('.chip-falso').exists()).toBe(false);
  });

  it('cerrado, el resumen se ve igual: es lo único que dice qué hay adentro', () => {
    const w = montar(false);
    expect(w.text()).toContain('3 impagas · ARS 1.543.000');
  });
});

describe('BloqueColapsable · montaje lazy-once', () => {
  it('cerrado y nunca abierto NO monta el contenido: no pide nada', () => {
    const w = montar(false);

    expect(montajes).toBe(0);
    expect(w.find('.borrador').exists()).toBe(false);
  });

  it('abierto de entrada monta una sola vez', () => {
    const w = montar(true);

    expect(montajes).toBe(1);
    expect(w.find('.borrador').exists()).toBe(true);
  });

  it('la primera apertura monta, y cerrar después NO desmonta', async () => {
    const w = montar(false);
    expect(montajes).toBe(0);

    await w.setProps({ abierto: true });
    expect(montajes).toBe(1);
    expect(w.find('.borrador').exists()).toBe(true);

    await w.setProps({ abierto: false });

    // Éste es el caso que justifica el lazy-ONCE: el contenido sigue en el DOM,
    // escondido. Si se desmontara, el borrador de WhatsApp y el textarea a medio
    // editar se irían con él.
    expect(w.find('.borrador').exists()).toBe(true);
    expect(w.find('.cuerpo').attributes('hidden')).toBeDefined();

    await w.setProps({ abierto: true });
    // Y al volver a abrir no se re-montó: el trabajo de la persona sobrevivió.
    expect(montajes).toBe(1);
  });
});
