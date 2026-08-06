import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Vencimientos.
 *
 * Se prueba porque **estuvo rota en `main` y ningún test se enteró**: el front
 * pedía `porPagina=200`, `PaginacionDto` topea en `@Max(100)`, la API devolvía
 * 400 — y la pantalla mostraba el mensaje del validador en inglés y, debajo,
 * «Nada por vencer · 0 en los próximos 90 días». Con seis cuotas en mora en la
 * misma base.
 *
 * El gate que la cubría era de API (`paginacion.spec.ts`) y pasaba. Es el error
 * #2 del playbook: un gate de API no cierra una feature que tiene pantalla.
 *
 * Los dos primeros casos son el bug exacto. El tercero es la regla general que
 * salió de él, y es la que hay que copiar a las demás pantallas:
 * **un error de carga nunca comparte pantalla con un total.**
 */

const respuestas: Array<unknown> = [];
let pedidos: string[] = [];

vi.mock('../src/api/cliente', () => ({
  api: vi.fn((url: string) => {
    pedidos.push(url);
    const r = respuestas.shift();
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  }),
  // La pantalla hace `e instanceof ApiError` para elegir el mensaje.
  ApiError: class ApiError extends Error {
    paraMostrar: string;
    constructor(paraMostrar: string) {
      super(paraMostrar);
      this.paraMostrar = paraMostrar;
    }
  },
}));

import VencimientosPage from '../src/paginas/VencimientosPage.vue';
import { ApiError } from '../src/api/cliente';

const vencimiento = (i: number) => ({
  tipo: 'cuota' as const,
  entidadId: `e${i}`,
  contratoId: `c${i}`,
  fecha: '2020-01-10',
  etiquetaPropiedad: `PROP-000${i}`,
  referencia: 'Arístides Villanueva 345',
  monto: 485000,
  moneda: 'ARS',
  detalle: null,
});

const pagina = (items: unknown[], total = items.length) => ({
  items, total, pagina: 1, porPagina: 100, paginas: Math.ceil(total / 100),
});

const montar = () =>
  mount(VencimientosPage, {
    global: { stubs: { RouterLink: true } },
  });

beforeEach(() => {
  respuestas.length = 0;
  pedidos = [];
});

describe('VencimientosPage', () => {
  it('no pide más de lo que el contrato de paginación admite', async () => {
    respuestas.push(pagina([]));
    montar();
    await flushPromises();

    // `PaginacionDto` valida `@Max(100)`. Pedir 200 era un 400 garantizado.
    const porPagina = Number(new URL(pedidos[0], 'http://x').searchParams.get('porPagina'));
    expect(porPagina).toBeLessThanOrEqual(100);
    expect(porPagina).toBeGreaterThan(0);
  });

  it('si la carga falla NO dice que no hay nada por vencer', async () => {
    respuestas.push(new ApiError('No se pudo'));
    const w = montar();
    await flushPromises();

    expect(w.find('.alert').exists()).toBe(true);
    // Éstas son las dos frases que la pantalla mostraba encima de un error.
    expect(w.text()).not.toContain('Nada por vencer');
    expect(w.text()).not.toMatch(/\b0 en los próximos\b/);
  });

  it('con error tampoco hay bajada con un total: un cero al lado de un error es un número inventado', async () => {
    respuestas.push(new ApiError('No se pudo'));
    const w = montar();
    await flushPromises();

    expect(w.text()).not.toMatch(/en los próximos \d+ días/);
    // Y el error tiene salida, no sólo descripción.
    expect(w.find('.alert .btn').text()).toBe('Reintentar');
  });

  it('con datos sí muestra el total y agrupa por urgencia', async () => {
    respuestas.push(pagina([vencimiento(1), vencimiento(2)]));
    const w = montar();
    await flushPromises();

    expect(w.text()).toContain('2 en los próximos 90 días');
    expect(w.text()).toContain('Vencido');
    expect(w.find('.alert').exists()).toBe(false);
  });

  it('cuando hay más de una página lo dice y ofrece la salida', async () => {
    respuestas.push(pagina([vencimiento(1)], 140));
    const w = montar();
    await flushPromises();

    // Truncar no es paginar: si hay 140 y se ven 1, hay que decirlo Y dar cómo
    // llegar al resto.
    expect(w.text()).toContain('140 en los próximos 90 días');
    expect(w.text()).toContain('se muestran los 1 más próximos');
    expect(w.find('.mas .btn').text()).toBe('Ver 139 más');
  });

  it('«Ver más» agrega a la lista en vez de reemplazarla', async () => {
    respuestas.push(pagina([vencimiento(1)], 2));
    respuestas.push({ items: [vencimiento(2)], total: 2, pagina: 2, porPagina: 100, paginas: 2 });
    const w = montar();
    await flushPromises();

    await w.find('.mas .btn').trigger('click');
    await flushPromises();

    expect(w.text()).toContain('PROP-0001');
    expect(w.text()).toContain('PROP-0002');
    // Y pidió la página 2, no otra vez la 1.
    expect(pedidos[1]).toContain('pagina=2');
    // Ya no faltan: el botón se va.
    expect(w.find('.mas').exists()).toBe(false);
  });
});
