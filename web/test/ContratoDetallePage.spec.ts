import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La ficha del contrato con sus bloques plegables.
 *
 * Lo que se prueba es lo que decide si la feature sirve, no que el acordeón se
 * abra:
 *
 * · **Una cabecera cerrada dice su número.** Un bloque plegado que no dice nada
 *   no es un bloque plegado, es un bloque escondido — y esconder la cobranza es
 *   peor que hacer scroll.
 * · **El número sale del endpoint, no del contenido.** Es lo que hace posible
 *   que el bloque cerrado no monte: si para decir «3 impagas» hubiera que montar
 *   las cuotas, plegarlo no habría ahorrado nada.
 * · **Lo que un hijo cambia refresca la cabecera.** Sin esto, cobrás adentro y
 *   la cabecera sigue diciendo «3 impagas» justo después de la acción que la
 *   contradice, que es el peor momento posible para mentir.
 * · **`?nuevo=1` abre de cortesía y NO escribe la preferencia.**
 */

const respuestas = new Map<string, unknown>();
let pedidos: string[] = [];

vi.mock('../src/api/cliente', () => ({
  api: vi.fn((url: string) => {
    pedidos.push(url);
    const r = respuestas.get(url);
    if (r === undefined) return Promise.resolve({ items: [], total: 0 });
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  }),
  ApiError: class ApiError extends Error {
    paraMostrar: string;
    constructor(paraMostrar: string) {
      super(paraMostrar);
      this.paraMostrar = paraMostrar;
    }
  },
}));

let query: Record<string, string> = {};
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'c-1' }, query }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}));

import ContratoDetallePage from '../src/paginas/ContratoDetallePage.vue';
import { useAuth } from '../src/stores/auth';

const CONTRATO = {
  id: 'c-1',
  propiedad: { etiqueta: 'PROP-0001', direccion: 'Arístides Villanueva 345' },
  fechaInicio: '2026-01-01', fechaFin: '2028-12-31',
  montoInicial: 400000, montoVigente: 514682, moneda: 'ARS',
  indice: 'ipc', periodicidadMeses: 3, administrado: true,
  honorariosPct: 10, estado: 'vigente',
  locadores: [{ nombre: 'Sofía Álvarez', porcentaje: 100 }],
  locatarios: [{ nombre: 'Juan Pérez' }],
};

const FICHA = {
  contratoId: 'c-1',
  garantes: {
    total: 1, aptos: 1, minimo: 2, enRegla: false,
    pendientes: 1, primerPendiente: 'falta consultar el BCRA',
  },
  cuotas: {
    generadas: 120, impagas: 3, vencidas: 0,
    deuda: { monto: 1543000, moneda: 'ARS' }, proximaVence: '2026-09-10',
  },
  aumentos: {
    total: 2, proyectados: 1,
    proximo: {
      vigenteDesde: '2026-11-01', montoAnterior: 485000, montoNuevo: 514682,
      moneda: 'ARS', estado: 'proyectado',
    },
    atrasado: null,
  },
  comision: { armada: true, repartida: true, sinCobrar: 0, total: { monto: 485000, moneda: 'ARS' } },
  documentos: { total: 3, sinMandar: 1, ultimoEl: '2026-08-04T15:00:00.000Z' },
  notas: { total: 7, pendientes: 0, ultimaEl: '2026-08-04T15:00:00.000Z' },
};

const pagina = (items: unknown[], total = items.length) => ({
  items, total, pagina: 1, porPagina: 100, paginas: 1,
});

function base(ficha: unknown = FICHA) {
  respuestas.set('/contratos/c-1', CONTRATO);
  respuestas.set('/contratos/c-1/ficha', ficha);
  respuestas.set('/contratos/c-1/ajustes?porPagina=100', pagina([]));
  respuestas.set('/contratos/c-1/periodos?porPagina=100', pagina([], 120));
}

// Los stubs llevan `name` a propósito: sin él `findComponent({ name })` no los
// encuentra y no se puede emitir el `cambio` que es justo lo que se prueba.
const STUBS = {
  RouterLink: true,
  GarantesContrato: { name: 'GarantesContrato', template: '<div class="garantes-stub" />' },
  ComisionContrato: { name: 'ComisionContrato', template: '<div class="comision-stub" />' },
  PanelDocumentos: { name: 'PanelDocumentos', template: '<div class="docs-stub" />' },
  PanelNotas: { name: 'PanelNotas', template: '<div class="notas-stub" />' },
};

const montar = () => mount(ContratoDetallePage, { global: { stubs: STUBS } });

/** El texto de la cabecera de un bloque, sin lo que tenga adentro. */
function cabecera(w: ReturnType<typeof mount>, id: string): string {
  const bloque = w.findAll('section.bloque').find(
    (s) => s.find('h2')?.attributes('id') === `bloque-${id}-titulo`,
  );
  return bloque?.find('.cab').text() ?? '';
}

beforeEach(() => {
  setActivePinia(createPinia());
  useAuth().usuario = { id: 'u1', nombre: 'Sofía' };
  localStorage.clear();
  respuestas.clear();
  pedidos = [];
  query = {};
});

describe('ContratoDetallePage · la cabecera cerrada dice su número', () => {
  it('Garantes está cerrado por defecto y aun así dice cuántos faltan y qué falta', async () => {
    base();
    const w = montar();
    await flushPromises();

    // Cerrado: no montó su contenido.
    expect(w.find('.garantes-stub').exists()).toBe(false);
    // Y sin embargo la cabecera dice el estado y el primer pendiente textual,
    // que es lo que dice QUÉ hacer.
    expect(cabecera(w, 'garantes')).toContain('1 de 2 en regla');
    expect(cabecera(w, 'garantes')).toContain('falta consultar el BCRA');
  });

  it('Comisión cerrada dice el monto CON su moneda', async () => {
    base();
    const w = montar();
    await flushPromises();

    expect(w.find('.comision-stub').exists()).toBe(false);
    // Ningún monto sin moneda, tampoco en un resumen de tres palabras.
    expect(cabecera(w, 'comision')).toContain('ARS 485.000');
    expect(cabecera(w, 'comision')).toContain('cobrada');
  });

  it('Pre-contrato cerrado dice cuántos hay y cuántos no salieron', async () => {
    base();
    const w = montar();
    await flushPromises();

    expect(w.find('.docs-stub').exists()).toBe(false);
    expect(cabecera(w, 'documentos')).toContain('3 documentos');
    expect(cabecera(w, 'documentos')).toContain('1 sin mandar');
  });

  it('Seguimiento cerrado dice cuántas notas hay', async () => {
    base();
    const w = montar();
    await flushPromises();

    expect(w.find('.notas-stub').exists()).toBe(false);
    expect(cabecera(w, 'seguimiento')).toContain('7 notas');
  });

  it('Cuotas y Aumentos arrancan abiertos: es a lo que se entra a la ficha', async () => {
    base();
    const w = montar();
    await flushPromises();

    expect(cabecera(w, 'cuotas')).toContain('3 cuotas por cobrar');
    expect(cabecera(w, 'cuotas')).toContain('ARS 1.543.000');
    expect(cabecera(w, 'aumentos')).toContain('01/11/2026');
    expect(cabecera(w, 'aumentos')).toContain('Proyectado');
  });
});

describe('ContratoDetallePage · los conteos salen del endpoint, no de la página de 100', () => {
  it('con 120 cuotas y 100 en pantalla, la cabecera cuenta sobre el total y lo dice', async () => {
    base();
    // La página trae 100 de 120: es el bug que esta feature convertía en una
    // afirmación falsa si los números salieran del array.
    respuestas.set(
      '/contratos/c-1/periodos?porPagina=100',
      pagina(
        Array.from({ length: 100 }, (_, i) => ({
          id: `p${i}`, periodo: '2026-01-01', venceEl: '2026-01-10',
          montoAlquiler: 1, expensas: 0, total: 1, moneda: 'ARS',
          estado: 'pagado', cobrado: 1, saldo: 0,
        })),
        120,
      ),
    );
    const w = montar();
    await flushPromises();

    // Truncar no es paginar: si hay 120 y se ven 100, se dice.
    expect(w.text()).toContain('de 120');
    // Y el número de la cabecera es el real, no «100».
    expect(cabecera(w, 'cuotas')).toContain('3 cuotas por cobrar');
  });

  it('pide el resumen en el mismo viaje que el resto, y una sola vez', async () => {
    base();
    montar();
    await flushPromises();

    expect(pedidos.filter((u) => u === '/contratos/c-1/ficha')).toHaveLength(1);
  });
});

describe('ContratoDetallePage · la cabecera no se queda mintiendo', () => {
  it('lo que cambia un hijo vuelve a pedir el resumen', async () => {
    base();
    const w = montar();
    await flushPromises();

    // Se abre Garantes y adentro pasa algo (consultar el BCRA, firmar…).
    await w.findAll('section.bloque')
      .find((s) => s.find('h2')?.attributes('id') === 'bloque-garantes-titulo')!
      .find('button').trigger('click');
    await flushPromises();

    const antes = pedidos.filter((u) => u === '/contratos/c-1/ficha').length;

    respuestas.set('/contratos/c-1/ficha', {
      ...FICHA,
      garantes: { total: 2, aptos: 2, minimo: 2, enRegla: true, pendientes: 0, primerPendiente: null },
    });
    w.findComponent({ name: 'GarantesContrato' }).vm.$emit('cambio');
    await flushPromises();

    expect(pedidos.filter((u) => u === '/contratos/c-1/ficha').length).toBe(antes + 1);
    // Y la cabecera ya dice lo nuevo, no lo de hace diez segundos.
    expect(cabecera(w, 'garantes')).toContain('2 de 2 en regla');
  });

  it('si el refresco del resumen falla, la cabecera conserva el número viejo en vez de vaciarse', async () => {
    base();
    const w = montar();
    await flushPromises();

    // Hay que abrirlo primero: cerrado y nunca abierto el hijo no está montado
    // —eso es el lazy-once— y por lo tanto no puede emitir nada.
    await w.findAll('section.bloque')
      .find((s) => s.find('h2')?.attributes('id') === 'bloque-seguimiento-titulo')!
      .find('button').trigger('click');
    await flushPromises();

    respuestas.set('/contratos/c-1/ficha', new Error('sin red'));
    w.findComponent({ name: 'PanelNotas' }).vm.$emit('cambio');
    await flushPromises();

    // Un dato de hace diez segundos es mejor que un guión, y el bloque abierto
    // ya muestra la verdad.
    expect(cabecera(w, 'seguimiento')).toContain('7 notas');
    expect(w.find('.alert').exists()).toBe(false);
  });
});

describe('ContratoDetallePage · la preferencia y la apertura de cortesía', () => {
  it('cerrar un bloque queda guardado sólo para ese bloque y para ese usuario', async () => {
    base();
    const w = montar();
    await flushPromises();

    await w.findAll('section.bloque')
      .find((s) => s.find('h2')?.attributes('id') === 'bloque-cuotas-titulo')!
      .find('button').trigger('click');

    const guardado = JSON.parse(localStorage.getItem('bemo_inmo_bloques_contrato_u1')!);
    expect(guardado).toEqual({ cuotas: false });
  });

  it('?nuevo=1 abre garantes, comisión y pre-contrato SIN escribir la preferencia', async () => {
    base();
    query = { nuevo: '1' };
    const w = montar();
    await flushPromises();

    // Los tres montaron: el pre-contrato recién generado está en pantalla al
    // aterrizar, sin un clic.
    expect(w.find('.garantes-stub').exists()).toBe(true);
    expect(w.find('.comision-stub').exists()).toBe(true);
    expect(w.find('.docs-stub').exists()).toBe(true);

    // Pero nada quedó guardado: fue cortesía del sistema, no una decisión de la
    // persona. Si se guardara, la próxima ficha —la de un contrato de hace dos
    // años— abriría con tres bloques que nadie pidió.
    expect(localStorage.getItem('bemo_inmo_bloques_contrato_u1')).toBeNull();
  });

  it('sin ?nuevo=1 esos tres bloques arrancan cerrados y no piden nada', async () => {
    base();
    const w = montar();
    await flushPromises();

    expect(w.find('.garantes-stub').exists()).toBe(false);
    expect(w.find('.comision-stub').exists()).toBe(false);
    expect(w.find('.docs-stub').exists()).toBe(false);
  });

  it('el control de arriba dice CUÁNTOS bloques hay cerrados', async () => {
    base();
    const w = montar();
    await flushPromises();

    // Cuatro cerrados por defecto: garantes, comisión, documentos y seguimiento.
    expect(w.find('.control').text()).toContain('Abrir los 4 bloques cerrados');
  });
});

describe('ContratoDetallePage · un contrato de intermediación', () => {
  it('sin cuotas no dibuja el bloque ni inventa un resumen en cero', async () => {
    base({ ...FICHA, cuotas: null });
    respuestas.set('/contratos/c-1', { ...CONTRATO, administrado: false });
    const w = montar();
    await flushPromises();

    expect(cabecera(w, 'cuotas')).toBe('');
    expect(w.text()).toContain('intermediación');
    expect(w.text()).not.toContain('Al día');
  });
});
