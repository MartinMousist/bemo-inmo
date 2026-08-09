import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La hoja imprimible, en sus dos formatos.
 *
 * Se prueba acá y no a ojo porque **la rama es invisible en una captura**: un
 * documento viejo y uno nuevo se ven parecidos en pantalla, y lo que cambia es
 * si el texto pasa por `v-html` o por el `<pre>` monoespaciado. Equivocarse
 * tiene dos formas, las dos feas: un documento en HTML impreso dentro de un
 * `<pre>` sale con las etiquetas a la vista, y uno en texto plano metido en un
 * `v-html` pierde todos los saltos de línea del contrato.
 *
 * Y el tercer caso es el que sostiene la decisión de congelar `formato` en la
 * fila del documento: un papel que salió monoespaciado tiene que seguir
 * saliendo así aunque su plantilla ya se haya convertido.
 */

const respuestas: Array<unknown> = [];

vi.mock('../src/api/cliente', () => ({
  api: vi.fn(() => {
    const r = respuestas.shift();
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

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'doc-1' } }),
  RouterLink: { template: '<a><slot /></a>' },
}));

import DocumentoImprimirPage from '../src/paginas/DocumentoImprimirPage.vue';

const doc = (extra: Record<string, unknown>) => ({
  id: 'doc-1',
  plantillaNombre: 'Pre-contrato de locación',
  titulo: null,
  textoFinal: '',
  formato: 'html',
  editado: false,
  faltantes: [],
  generadoPor: 'Ana Torres',
  createdAt: '2026-08-09T13:00:00.000Z',
  envios: [],
  contrato: { etiqueta: 'PROP-0001', direccion: 'Roca 55', inmobiliaria: 'Andes' },
  ...extra,
});

beforeEach(() => {
  respuestas.length = 0;
  // `window.print()` no existe en jsdom y la página lo llama al montarse.
  window.print = vi.fn();
  vi.useFakeTimers();
});

async function montar(fila: Record<string, unknown>) {
  respuestas.push(doc(fila), {});
  const w = mount(DocumentoImprimirPage, {
    // `RouterLink` lo resuelve el router de verdad, que acá está mockeado.
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  await flushPromises();
  return w;
}

describe('DocumentoImprimirPage', () => {
  it('un documento en HTML se pinta con la tipografía del documento', async () => {
    const w = await montar({
      formato: 'html',
      textoFinal: '<h2>PRIMERA — OBJETO</h2><p>El <strong>LOCADOR</strong> da en locación.</p>',
    });

    const hoja = w.find('.documento');
    expect(hoja.exists()).toBe(true);
    // La partición en castellano necesita el `lang`: sin él, `hyphens: auto`
    // no sabe con qué diccionario cortar y el justificado deja ríos.
    expect(hoja.attributes('lang')).toBe('es-AR');
    expect(hoja.find('h2').text()).toBe('PRIMERA — OBJETO');
    expect(hoja.find('strong').text()).toBe('LOCADOR');
    // Y NO sale el <pre>: si saliera, se imprimirían las etiquetas.
    expect(w.find('pre.texto').exists()).toBe(false);
  });

  it('un documento viejo, en texto plano, sigue saliendo en el <pre>', async () => {
    const w = await montar({
      formato: 'texto',
      textoFinal: 'CONTRATO\n\nPRIMERA — OBJETO.\nEl LOCADOR da en locación.',
    });

    const pre = w.find('pre.texto');
    expect(pre.exists()).toBe(true);
    // El texto va tal cual, con sus saltos: es lo que se entregó.
    expect(pre.text()).toContain('PRIMERA — OBJETO.');
    expect(w.find('.documento').exists()).toBe(false);
  });

  it('un < del texto plano NO se interpreta como etiqueta', async () => {
    // El `<pre>` interpola, no hace `v-html`: un contrato que dice
    // «superficie < 30 m2» no puede abrir una etiqueta.
    const w = await montar({ formato: 'texto', textoFinal: 'Superficie < 30 m2' });
    expect(w.find('pre.texto').text()).toBe('Superficie < 30 m2');
  });

  it('las variables sin dato se avisan arriba de la hoja', async () => {
    const w = await montar({
      formato: 'html',
      textoFinal: '<p>Paga «contrato.deposito»</p>',
      faltantes: ['contrato.deposito'],
    });
    // Un hueco visible es lo que hace que alguien lo complete antes de firmar.
    expect(w.find('.faltan').text()).toContain('contrato.deposito');
  });
});
