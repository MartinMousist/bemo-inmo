import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El alta de contrato, y el pre-contrato que nace con él.
 *
 * El pedido del dueño, textual y repetido: *«el pre contrato debe estar cargado
 * EL TEXTO a la hora que se crea un contrato»*. Lo que esta pantalla tiene que
 * garantizar es que eso **se diga antes** y **se verifique después**, y que nada
 * de todo eso pueda voltear la creación del contrato.
 *
 * El caso más importante es el último: si la verificación del papel falla, el
 * contrato IGUAL se abre. Es la lección de `VencimientosPage.spec.ts` —un error
 * nunca comparte pantalla con un éxito— llevada al orden inverso: un problema
 * con lo accesorio nunca puede esconder lo principal, que ya pasó.
 */

const respuestas = new Map<string, unknown>();
let pedidos: Array<{ url: string; metodo: string }> = [];

vi.mock('../src/api/cliente', () => ({
  api: vi.fn((url: string, opciones?: { method?: string }) => {
    pedidos.push({ url, metodo: opciones?.method ?? 'GET' });
    const r = respuestas.get(url);
    if (r === undefined) return Promise.resolve({ items: [] });
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

const replace = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace, back: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}));

import ContratoFormPage from '../src/paginas/ContratoFormPage.vue';
import { ApiError } from '../src/api/cliente';
import { useUi } from '../src/stores/ui';
import { useAuth } from '../src/stores/auth';

const PLANTILLA_PRE = {
  id: 'pl-1', tipo: 'pre_contrato_alquiler', nombre: 'Pre-contrato de locación', activa: true,
};

/** El documento como lo devuelve `GET /contratos/:id/documentos`. */
const DOC_PRE = {
  plantillaTipo: 'pre_contrato_alquiler',
  plantillaNombre: 'Pre-contrato de locación',
};

function base(plantillas: unknown[] = [PLANTILLA_PRE]) {
  respuestas.set('/propiedades?porPagina=100', {
    items: [{ id: 'p1', etiqueta: 'PROP-0001', direccion: 'Arístides Villanueva 345' }],
  });
  respuestas.set('/personas?porPagina=100', {
    items: [{ id: 'per1', nombreCompleto: 'Sofía Álvarez' }],
  });
  respuestas.set('/plantillas', plantillas);
}

/** Completa lo mínimo y aprieta «Crear contrato». */
async function crear(w: ReturnType<typeof mount>, conInquilino = true) {
  const vm = w.vm as unknown as { f: Record<string, unknown> };
  vm.f.propiedadId = 'p1';
  vm.f.fechaInicio = '2026-09-01';
  vm.f.fechaFin = '2028-08-31';
  vm.f.montoInicial = '485000';
  if (conInquilino) vm.f.locatarioId = 'per1';
  await w.vm.$nextTick();
  await w.find('form').trigger('submit');
  await flushPromises();
}

const montar = () => mount(ContratoFormPage, { global: { stubs: { RouterLink: true } } });

beforeEach(() => {
  setActivePinia(createPinia());
  useAuth().rol = 'owner';
  respuestas.clear();
  pedidos = [];
  replace.mockClear();
});

describe('ContratoFormPage · lo que se dice ANTES de apretar', () => {
  it('con plantilla dice que el pre-contrato se arma solo y con cuál', async () => {
    base();
    const w = montar();
    await flushPromises();

    // «Se arma solo»: no hay checkbox, ni botón, ni ningún clic intermedio.
    expect(w.text()).toContain('se arma solo');
    expect(w.text()).toContain('Pre-contrato de locación');
    expect(w.find('input[type="checkbox"][value="pre"]').exists()).toBe(false);
  });

  it('sin inquilino avisa que el pre-contrato sale sin la parte locataria', async () => {
    base();
    const w = montar();
    await flushPromises();

    // Arranca sin inquilino: el aviso tiene que estar.
    expect(w.text()).toContain('Sin inquilino elegido');
    expect(w.text()).toContain('parte locataria');

    // Y al elegir uno desaparece: un aviso que no aplica entrena a ignorarlos.
    (w.vm as unknown as { f: Record<string, unknown> }).f.locatarioId = 'per1';
    await w.vm.$nextTick();
    expect(w.text()).not.toContain('Sin inquilino elegido');
  });

  it('avisa que los garantes no salen y que el documento es una FOTO', async () => {
    base();
    const w = montar();
    await flushPromises();

    expect(w.text()).toContain('garantes');
    // Lo que evita que alguien imprima en marzo el papel de enero creyendo que
    // se puso al día: `texto_generado` es inmutable por diseño de la 020.
    expect(w.text()).toContain('foto del momento');
    expect(w.text()).toContain('no lo actualiza');
  });

  it('sin ninguna plantilla lo dice y ofrece traer las base', async () => {
    base([]);
    const w = montar();
    await flushPromises();

    expect(w.text()).toContain('no tiene ninguna plantilla de pre-contrato');
    const boton = w.findAll('button').find((b) => b.text().includes('Traer las plantillas base'));
    expect(boton).toBeDefined();

    respuestas.set('/plantillas', [PLANTILLA_PRE]);
    await boton!.trigger('click');
    await flushPromises();

    // Sembró y releyó la lista sin salir del formulario.
    expect(pedidos.some((p) => p.url === '/plantillas/sembrar' && p.metodo === 'POST')).toBe(true);
    expect(w.text()).toContain('se arma solo');
  });

  it('a un asesor no se le dibuja el botón: dice quién puede y adónde ir', async () => {
    base([]);
    useAuth().rol = 'agente';
    const w = montar();
    await flushPromises();

    // `POST /plantillas/sembrar` es owner/admin. Un control que sólo sirve para
    // dar 403 no es un control.
    expect(w.findAll('button').some((b) => b.text().includes('Traer las plantillas base'))).toBe(false);
    expect(w.text()).toContain('titular o Administración');
  });

  it('si no se pudo leer el listado de plantillas no afirma que no hay ninguna', async () => {
    base();
    respuestas.set('/plantillas', new ApiError('Sin red'));
    const w = montar();
    await flushPromises();

    // No saber y no haber son cosas distintas.
    expect(w.text()).not.toContain('no tiene ninguna plantilla de pre-contrato');
    expect(w.text()).toContain('No se pudo leer el listado de plantillas');
    // Y el formulario sigue usable: esto no bloquea cargar un contrato.
    expect(w.find('form').exists()).toBe(true);
  });
});

describe('ContratoFormPage · al guardar', () => {
  it('crea el contrato y aterriza en la ficha con ?nuevo=1', async () => {
    base();
    respuestas.set('/contratos', { id: 'c-99' });
    respuestas.set('/contratos/c-99/documentos', [DOC_PRE]);

    const w = montar();
    await flushPromises();
    await crear(w);

    expect(pedidos.some((p) => p.url === '/contratos' && p.metodo === 'POST')).toBe(true);
    // `?nuevo=1` es lo que abre garantes, comisión y pre-contrato de cortesía y
    // deja el texto ya abierto en el textarea.
    expect(replace).toHaveBeenCalledWith('/contratos/c-99?nuevo=1');
  });

  it('el resultado del papel se AFIRMA leyéndolo, no suponiéndolo', async () => {
    base();
    respuestas.set('/contratos', { id: 'c-99' });
    respuestas.set('/contratos/c-99/documentos', [DOC_PRE]);

    const w = montar();
    await flushPromises();
    await crear(w);

    // Preguntó de verdad si el documento quedó.
    expect(pedidos.some((p) => p.url === '/contratos/c-99/documentos')).toBe(true);

    const ui = useUi();
    expect(ui.toasts[0].tono).toBe('ok');
    expect(ui.toasts[0].titulo).toBe('Contrato creado');
    expect(ui.toasts[0].detalle).toContain('Pre-contrato de locación');
    expect(ui.toasts[0].detalle).toContain('sin mandar');
  });

  it('si el contrato quedó SIN pre-contrato lo dice, y el contrato igual se abre', async () => {
    base([]);
    respuestas.set('/contratos', { id: 'c-99' });
    respuestas.set('/contratos/c-99/documentos', []);

    const w = montar();
    await flushPromises();
    await crear(w);

    const ui = useUi();
    expect(ui.toasts[0].tono).toBe('err');
    expect(ui.toasts[0].titulo).toContain('sin pre-contrato');
    // Lo importante: el contrato existe y se navega igual.
    expect(replace).toHaveBeenCalledWith('/contratos/c-99?nuevo=1');
    // Y el error va por toast, NO como bloque rojo encima del formulario: el
    // contrato se creó bien y un `.alert` ahí diría lo contrario.
    expect(w.find('.alert').exists()).toBe(false);
  });

  it('si la verificación del papel falla, el contrato IGUAL se abre y no se miente', async () => {
    base();
    respuestas.set('/contratos', { id: 'c-99' });
    respuestas.set('/contratos/c-99/documentos', new ApiError('Se cayó la red'));

    const w = montar();
    await flushPromises();
    await crear(w);

    // Éste es el caso que no se puede romper nunca: el contrato ya existe.
    expect(replace).toHaveBeenCalledWith('/contratos/c-99?nuevo=1');
    expect(w.find('.alert').exists()).toBe(false);

    const ui = useUi();
    // Ni «quedó armado» ni «no hay»: no se sabe, así que se dice dónde mirar.
    expect(ui.toasts[0].tono).toBe('ok');
    expect(ui.toasts[0].detalle).toContain('Pre-contrato y avisos');
    expect(ui.toasts[0].detalle).not.toContain('quedó armado');
  });

  it('si falla la creación del contrato NO navega y el error se ve en la pantalla', async () => {
    base();
    respuestas.set('/contratos', new ApiError('Esa propiedad ya tiene un contrato vigente.'));

    const w = montar();
    await flushPromises();
    await crear(w);

    expect(replace).not.toHaveBeenCalled();
    expect(w.find('.alert').text()).toContain('ya tiene un contrato vigente');
    // Y no se pidieron los documentos de un contrato que no existe.
    expect(pedidos.some((p) => p.url.includes('/documentos'))).toBe(false);
  });
});
