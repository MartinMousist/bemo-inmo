import { describe, expect, it } from 'vitest';
import { atributosDe, superficieDe } from '../src/dominio/atributos';

/**
 * Los casos de papel de la fila de íconos de la tarjeta.
 *
 * Hay uno por cada tipo que existe de verdad en la base de la demo, con los
 * números que esa propiedad tiene hoy. La regla que se prueba es la que el
 * pedido puso primero: **un dato que falta no se muestra como cero**, y un
 * terreno no tiene dormitorios.
 */

describe('atributosDe · qué aplica a cada tipo', () => {
  it('un TERRENO no muestra ningún atributo', () => {
    // PROP-0013: un lote de 600 m². No tiene ambientes, ni baños, ni cocheras,
    // y sus columnas están todas en NULL. Mostrar «s/d» cuatro veces sería
    // pedirle a alguien que cargue datos que no existen.
    expect(
      atributosDe({
        tipo: 'terreno',
        ambientes: null, dormitorios: null, banos: null, cocheras: null,
      }),
    ).toEqual([]);
  });

  it('un CAMPO tampoco', () => {
    expect(atributosDe({ tipo: 'campo' })).toEqual([]);
  });

  it('una COCHERA muestra cocheras y NADA de baños', () => {
    // PROP-0012: 14 m², `banos` en NULL. Un «s/d» en baños acá sería un dato
    // faltante inventado.
    const chips = atributosDe({
      tipo: 'cochera',
      ambientes: null, dormitorios: null, banos: null, cocheras: 1,
    });
    expect(chips.map((c) => c.clave)).toEqual(['cocheras']);
    expect(chips[0].texto).toBe('1');
  });

  it('un GALPÓN muestra baños y cocheras, no ambientes', () => {
    // PROP-0009: 800 m², 2 baños, 10 cocheras.
    const chips = atributosDe({
      tipo: 'galpon',
      ambientes: null, dormitorios: null, banos: 2, cocheras: 10,
    });
    expect(chips.map((c) => c.clave)).toEqual(['banos', 'cocheras']);
    expect(chips.map((c) => c.texto)).toEqual(['2', '10']);
  });

  it('una OFICINA muestra ambientes pero no dormitorios', () => {
    // PROP-0007: 3 ambientes, `dormitorios` en NULL. «Dormitorios» en una
    // oficina no significa nada, así que el chip no existe.
    const chips = atributosDe({
      tipo: 'oficina',
      ambientes: 3, dormitorios: null, banos: 1, cocheras: 1,
    });
    expect(chips.map((c) => c.clave)).toEqual(['ambientes', 'banos', 'cocheras']);
  });

  it('una CASA completa muestra los cuatro', () => {
    // PROP-0011: 4 ambientes, 3 dormitorios, 2 baños, 1 cochera.
    const chips = atributosDe({
      tipo: 'casa', ambientes: 4, dormitorios: 3, banos: 2, cocheras: 1,
    });
    expect(chips.map((c) => c.clave)).toEqual([
      'ambientes', 'dormitorios', 'banos', 'cocheras',
    ]);
    expect(chips.every((c) => c.estado === 'valor')).toBe(true);
  });
});

describe('atributosDe · 0 y NULL no son lo mismo', () => {
  it('un 0 se dice con palabras y NO se esconde', () => {
    // PROP-0004, un departamento con `cocheras = 0`. «No tiene cochera» es un
    // dato de compra: esconderlo lo confunde con «no lo cargaron».
    const chips = atributosDe({
      tipo: 'departamento', ambientes: 2, dormitorios: 1, banos: 1, cocheras: 0,
    });
    const cochera = chips.find((c) => c.clave === 'cocheras')!;
    expect(cochera.estado).toBe('cero');
    expect(cochera.texto).toBe('sin cochera');
    // Y sobre todo: nunca el número 0 suelto, que se lee como una cantidad.
    expect(cochera.texto).not.toBe('0');
  });

  it('un NULL dice «s/d» y su título explica qué falta cargar', () => {
    // El caso del local al que nadie le cargó las cocheras. Es distinto del 0:
    // el 0 es una respuesta, esto es una tarea pendiente.
    const chips = atributosDe({
      tipo: 'local', ambientes: null, dormitorios: null, banos: 2, cocheras: null,
    });
    const cochera = chips.find((c) => c.clave === 'cocheras')!;
    expect(cochera.estado).toBe('sin_dato');
    expect(cochera.texto).toBe('s/d');
    expect(cochera.titulo).toBe('Cocheras: sin cargar');
  });

  it('el 0 y el NULL del mismo atributo no se ven igual', () => {
    const conCero = atributosDe({ tipo: 'local', banos: 1, cocheras: 0 });
    const conNulo = atributosDe({ tipo: 'local', banos: 1, cocheras: null });
    const a = conCero.find((c) => c.clave === 'cocheras')!;
    const b = conNulo.find((c) => c.clave === 'cocheras')!;
    expect(a.texto).not.toBe(b.texto);
    expect(a.estado).not.toBe(b.estado);
  });
});

describe('atributosDe · el texto que lee un lector de pantalla', () => {
  it('el título es una frase completa y pluraliza bien', () => {
    const chips = atributosDe({ tipo: 'casa', ambientes: 1, dormitorios: 3, banos: 1, cocheras: 2 });
    expect(chips.find((c) => c.clave === 'ambientes')!.titulo).toBe('1 ambiente');
    expect(chips.find((c) => c.clave === 'dormitorios')!.titulo).toBe('3 dormitorios');
    expect(chips.find((c) => c.clave === 'banos')!.titulo).toBe('1 baño');
    expect(chips.find((c) => c.clave === 'cocheras')!.titulo).toBe('2 cocheras');
  });
});

describe('atributosDe · un tipo que el front todavía no conoce', () => {
  it('muestra sólo lo que tiene valor, sin inventar faltantes', () => {
    // Si mañana la base agrega un tipo y nadie toca la tabla, la salida honesta
    // es mostrar lo cargado: no esconde un dato real ni pide cargar uno que
    // quizás no aplique.
    const chips = atributosDe({
      tipo: 'quinta', ambientes: 5, dormitorios: null, banos: 2, cocheras: null,
    });
    expect(chips.map((c) => c.clave)).toEqual(['ambientes', 'banos']);
  });
});

describe('superficieDe', () => {
  it('cada número lleva su palabra', () => {
    // «140 / 180 m²» obliga a saber cuál es cuál, y los dos metrajes se
    // negocian por separado.
    expect(superficieDe({ supCubierta: 140, supTotal: 180 })).toBe('140 m² cub · 180 m² tot');
  });

  it('un terreno tiene total y no cubierta', () => {
    expect(superficieDe({ supCubierta: null, supTotal: 600 })).toBe('600 m² tot');
  });

  it('sin ningún metraje devuelve null y la tarjeta no dibuja la línea', () => {
    // Un renglón con dos guiones ocupa lugar y no dice nada.
    expect(superficieDe({ supCubierta: null, supTotal: null })).toBeNull();
    expect(superficieDe({})).toBeNull();
  });

  it('usa el separador de miles es-AR', () => {
    expect(superficieDe({ supTotal: 1200 })).toBe('1.200 m² tot');
  });
});
