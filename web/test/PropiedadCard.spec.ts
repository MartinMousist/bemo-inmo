import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import PropiedadCard from '../src/componentes/PropiedadCard.vue';
import type { PropiedadTarjeta } from '../src/dominio/propiedad';

/**
 * La tarjeta de la cartera.
 *
 * Se prueban las cuatro cosas que en una tarjeta se rompen sin que nadie las
 * note mirando la pantalla con datos lindos: que sea un enlace de verdad, que
 * la propiedad sin foto no pida una imagen vacía, que ningún monto salga sin su
 * moneda, y que la fila de íconos respete la regla de los faltantes.
 */

// `RouterLink` se stubea como un `<a>` real —y no con `stubs: true`— porque lo
// que se afirma es justamente que la raíz de la tarjeta es un ancla con su
// `aria-label`, no un `<div>` con `@click`.
const STUBS = { RouterLink: { template: '<a :aria-label="$attrs[\'aria-label\']"><slot /></a>' } };

const CASA: PropiedadTarjeta = {
  id: 'p1',
  etiqueta: 'PROP-0011',
  direccion: 'San Martín 1234, Ciudad',
  tipo: 'casa',
  supCubierta: 140,
  supTotal: 180,
  ambientes: 4,
  dormitorios: 3,
  banos: 2,
  cocheras: 1,
  fotoPortada: 'http://localhost:9000/bemo-inmo/x/portada.png',
  operaciones: [
    { id: 'o1', tipo: 'venta', precio: 92000, moneda: 'USD', estado: 'disponible' },
  ],
};

const montar = (p: Partial<PropiedadTarjeta> = {}, modo?: 'general' | 'venta' | 'alquiler') =>
  mount(PropiedadCard, {
    props: { propiedad: { ...CASA, ...p }, modo },
    global: { stubs: STUBS },
  });

describe('PropiedadCard', () => {
  it('la tarjeta entera es UN enlace, no un div clicable', () => {
    // Un `<div>` con `@click` + `@keydown.enter` obliga a poner `.stop` en todo
    // lo interactivo de adentro, y si se olvida uno el Enter abre la ficha. Con
    // un ancla, además, funcionan «abrir en pestaña nueva» y el clic del medio,
    // que en un listado es lo que uno quiere hacer.
    const w = montar();
    expect(w.element.tagName).toBe('A');
    expect(w.attributes('aria-label')).toContain('PROP-0011');
  });

  it('el nombre accesible trae lo mismo que se ve', () => {
    // Un `aria-label` en un enlace REEMPLAZA lo que se lee adentro: si se queda
    // corto, quien usa lector de pantalla ve menos que quien mira.
    const etiqueta = montar().attributes('aria-label') ?? '';
    expect(etiqueta).toContain('Casa');
    expect(etiqueta).toContain('San Martín 1234');
    expect(etiqueta).toContain('USD 92.000');
    expect(etiqueta).toContain('Disponible');
    expect(etiqueta).toContain('3 dormitorios');
  });

  it('sin foto muestra el placeholder y NO un <img> vacío', () => {
    // Un `src=""` lo pide el navegador igual y deja un ícono de imagen rota.
    const w = montar({ fotoPortada: null, tipo: 'terreno' });
    expect(w.find('img').exists()).toBe(false);
    expect(w.find('.placeholder').exists()).toBe(true);
    // El placeholder dice QUÉ es la propiedad, no sólo que falta la foto.
    expect(w.text()).toContain('Terreno');
    expect(w.text()).toContain('Sin foto cargada');
  });

  it('la foto se carga perezosa y con el hueco ya reservado', () => {
    const img = montar().find('img');
    expect(img.attributes('loading')).toBe('lazy');
    expect(img.attributes('decoding')).toBe('async');
    // `width`/`height` para que la grilla no salte cuando llegan las de abajo.
    expect(img.attributes('width')).toBeTruthy();
    expect(img.attributes('height')).toBeTruthy();
    // El `alt` va vacío a propósito: la imagen es decorativa dentro de un
    // enlace que ya tiene nombre accesible, y un alt con la dirección lo diría
    // dos veces.
    expect(img.attributes('alt')).toBe('');
  });

  it('ningún monto sin su moneda', () => {
    const texto = montar().text();
    expect(texto).toContain('USD 92.000');
    expect(texto).not.toMatch(/\$\s?92/);
  });

  it('un precio sin cargar se dice, no se muestra como cero', () => {
    const w = montar({
      operaciones: [{ id: 'o', tipo: 'venta', precio: null, moneda: 'USD', estado: 'borrador' }],
    });
    expect(w.text()).toContain('sin precio');
    expect(w.text()).not.toContain('USD 0');
  });

  it('un TERRENO no muestra íconos de dormitorio ni de baño', () => {
    // La regla del pedido, verificada en la pantalla y no sólo en el motor.
    const w = montar({
      tipo: 'terreno',
      ambientes: null, dormitorios: null, banos: null, cocheras: null,
      supCubierta: null, supTotal: 600,
    });
    expect(w.find('.atributos').exists()).toBe(false);
    expect(w.text()).toContain('600 m² tot');
    // Ni un cero, ni un guión, ni un «s/d»: para un lote esos atributos no
    // existen, así que no hay nada que decir sobre ellos.
    expect(w.text()).not.toContain('s/d');
    expect(w.text()).not.toContain('sin baño');
    expect(w.text()).not.toContain('sin cochera');
    // Y tampoco la línea de superficie CUBIERTA, que un terreno no tiene.
    expect(w.text()).not.toContain('m² cub');
  });

  it('un alquiler cerrado dice «Alquilada» y no «Cerrada»', () => {
    const w = montar({
      operaciones: [
        { id: 'o', tipo: 'alquiler', precio: 450000, moneda: 'ARS', estado: 'cerrada' },
      ],
    });
    expect(w.text()).toContain('Alquilada');
    expect(w.text()).not.toContain('Cerrada');
  });

  it('en la cartera de venta se muestra el precio de VENTA, no el del alquiler', () => {
    // Una propiedad puede estar en venta Y en alquiler. Mostrar la operación
    // equivocada es mostrar el número equivocado en la pantalla equivocada.
    const w = montar(
      {
        operaciones: [
          { id: 'v', tipo: 'venta', precio: 92000, moneda: 'USD', estado: 'disponible' },
          { id: 'a', tipo: 'alquiler', precio: 450000, moneda: 'ARS', estado: 'disponible' },
        ],
      },
      'venta',
    );
    expect(w.text()).toContain('USD 92.000');
    expect(w.text()).not.toContain('ARS 450.000');
  });

  it('con las dos operaciones a la vez, cada precio dice de qué es', () => {
    const w = montar(
      {
        operaciones: [
          { id: 'v', tipo: 'venta', precio: 92000, moneda: 'USD', estado: 'disponible' },
          { id: 'a', tipo: 'alquiler', precio: 450000, moneda: 'ARS', estado: 'disponible' },
        ],
      },
      'general',
    );
    expect(w.text()).toContain('Venta');
    expect(w.text()).toContain('Alquiler');
  });

  it('sin operación lo dice, en vez de dejar el hueco', () => {
    // Y lo dice sin afirmar de más: en el listado general las operaciones
    // cerradas no vienen, así que una propiedad VENDIDA llega con el array
    // vacío. «Sin operación cargada» sería un dato que esta pantalla no tiene.
    const w = montar({ operaciones: [] });
    expect(w.text()).toContain('Sin operación');
    expect(w.text()).not.toContain('Sin operación cargada');
  });
});
