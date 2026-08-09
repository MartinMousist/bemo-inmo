import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El mapa de la ficha de una propiedad.
 *
 * Existe por un defecto concreto: el iframe estaba detrás de la capacidad
 * `mapas`, que en realidad significaba «el servidor tiene API key **para
 * geocodificar**». Son dos cosas distintas —el embed va a
 * `www.google.com/maps?…&output=embed` y NO lleva key, verificado con un fetch
 * real desde el contenedor de la API— así que una propiedad con lat/lng
 * cargadas a mano mostraba «El mapa necesita la API key de Google» y escondía
 * un mapa que habría funcionado perfecto.
 *
 * Estos tests son lo que impide que las dos capacidades se vuelvan a juntar del
 * lado del front. El del backend, que `capacidades` las devuelve separadas,
 * está en `api/test/geocoding.spec.ts`.
 */

const respuestas = new Map<string, unknown>();

vi.mock('../src/api/cliente', () => ({
  api: vi.fn((url: string) => {
    const r = respuestas.get(url);
    return r === undefined
      ? Promise.reject(new Error(`sin respuesta para ${url}`))
      : Promise.resolve(r);
  }),
  ApiError: class ApiError extends Error {
    paraMostrar = 'error';
  },
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'p1' } }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import PropiedadDetallePage from '../src/paginas/PropiedadDetallePage.vue';

const propiedad = (extra: Record<string, unknown> = {}) => ({
  id: 'p1',
  etiqueta: 'PROP-0001',
  direccion: 'Arístides Villanueva 345, Mendoza',
  tipo: 'departamento',
  lat: -32.8908,
  lng: -68.8272,
  ubicacionConocida: true,
  geocodeFuente: 'manual',
  geocodeEl: '2026-08-08T12:00:00.000Z',
  supTotal: 78, supCubierta: 72,
  ambientes: 3, dormitorios: 2, banos: 1, cocheras: 1,
  antiguedad: 12, descripcion: null,
  agenteCaptador: null,
  operaciones: [],
  titulares: [],
  ...extra,
});

const montar = () =>
  mount(PropiedadDetallePage, {
    global: {
      stubs: {
        RouterLink: true,
        GaleriaFotos: true,
        EnlacePropietario: true,
        PanelNotas: true,
      },
    },
  });

beforeEach(() => {
  setActivePinia(createPinia());
  respuestas.clear();
});

describe('PropiedadDetallePage · ubicación', () => {
  it('con coordenadas y SIN API key muestra el mapa, no el cartel de la key', async () => {
    respuestas.set('/propiedades/p1', propiedad());
    respuestas.set('/propiedades/capacidades', {
      geocodificacion: false, // no hay key: no se puede geocodificar…
      mapaEmbebido: true, //    …pero el mapa embebido nunca la necesitó
      fotos: false,
    });

    const w = montar();
    await flushPromises();

    // El mapa arranca plegado —cargarlo en cada ficha es peso que nadie pidió—
    // pero el botón para verlo TIENE que estar.
    const ver = w.findAll('button').find((b) => b.text() === 'Ver el mapa');
    expect(ver).toBeDefined();

    // Y el cartel que mentía no está.
    expect(w.text()).not.toContain('El mapa necesita la API key');

    await ver!.trigger('click');
    const iframe = w.find('iframe');
    expect(iframe.exists()).toBe(true);
    // La URL del embed: sin `key=`, que es todo el punto.
    expect(iframe.attributes('src')).toContain('output=embed');
    expect(iframe.attributes('src')).not.toContain('key=');
  });

  it('sin coordenadas y sin key explica que se pueden cargar a mano', async () => {
    respuestas.set(
      '/propiedades/p1',
      propiedad({ lat: null, lng: null, ubicacionConocida: false }),
    );
    respuestas.set('/propiedades/capacidades', {
      geocodificacion: false, mapaEmbebido: true, fotos: false,
    });

    const w = montar();
    await flushPromises();

    expect(w.find('iframe').exists()).toBe(false);
    expect(w.text()).toContain('GOOGLE_MAPS_API_KEY');
    expect(w.text()).toContain('a mano');
  });

  it('dice de dónde salió la coordenada, y eso cambia lo que le pasa', async () => {
    // No es un detalle de sistema: una coordenada `manual` sobrevive a un
    // cambio de dirección y ninguna sincronización la pisa; una de `google` se
    // vuelve a resolver sola. La regla la hace cumplir el backend y acá es
    // donde el usuario se entera de cuál de las dos tiene enfrente.
    respuestas.set('/propiedades/p1', propiedad());
    respuestas.set('/propiedades/capacidades', {
      geocodificacion: false, mapaEmbebido: true, fotos: false,
    });

    const manual = montar();
    await flushPromises();
    expect(manual.text()).toContain('cargadas a mano');
    expect(manual.text()).toContain('08/08/2026');

    respuestas.set('/propiedades/p1', propiedad({ geocodeFuente: 'google' }));
    const google = montar();
    await flushPromises();
    expect(google.text()).toContain('Ubicada por Google');
    expect(google.text()).not.toContain('cargadas a mano');
  });

  it('si el embebido se apaga, degrada a las coordenadas y un enlace', async () => {
    // Esa URL no está documentada por Google —lo documentado es Maps Embed API,
    // que sí lleva key—, así que es una dependencia sin contrato. El día que
    // deje de andar se apaga `mapaEmbebido` en el backend y la ficha tiene que
    // seguir sirviendo, no quedar con un recuadro roto.
    respuestas.set('/propiedades/p1', propiedad());
    respuestas.set('/propiedades/capacidades', {
      geocodificacion: true, mapaEmbebido: false, fotos: false,
    });

    const w = montar();
    await flushPromises();

    expect(w.find('iframe').exists()).toBe(false);
    expect(w.text()).toContain('-32.89080');
    const enlace = w.find('a[href^="https://www.google.com/maps"]');
    expect(enlace.exists()).toBe(true);
    expect(enlace.attributes('target')).toBe('_blank');
    expect(enlace.attributes('rel')).toContain('noopener');
  });
});
