import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bloquesRecordados } from '../src/dominio/bloques';

/**
 * Las cuatro reglas de `bloques.ts`, cada una con el bug que evita.
 *
 * No es un test de "guarda y lee": eso lo cubriría cualquier implementación,
 * incluida la que guarda el estado completo — que es justo la que rompe dentro
 * de tres meses, cuando alguien agregue el octavo bloque y nadie lo vea nunca.
 * Lo que se prueba acá es **la forma del almacén**, que es la decisión.
 */

const DEFECTO = {
  resumen: true,
  garantes: false,
  comision: false,
  aumentos: true,
  cuotas: true,
  documentos: false,
  seguimiento: false,
};

const clave = (usuario: string) => `bemo_inmo_bloques_contrato_${usuario}`;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('bloques.ts · regla 1 — se guarda lo DECIDIDO, no el estado completo', () => {
  it('sólo escribe el bloque que se tocó, no los siete', () => {
    const b = bloquesRecordados('contrato', DEFECTO, 'u1');
    b.alternar('garantes');

    const guardado = JSON.parse(localStorage.getItem(clave('u1'))!);
    // Uno solo. Si acá hubiera siete claves, la regla 1 se perdió.
    expect(Object.keys(guardado)).toEqual(['garantes']);
    expect(guardado.garantes).toBe(true);
  });

  it('un bloque NUEVO llega con SU default, no cerrado e invisible', () => {
    // Alguien que ya usó la ficha y cerró un par de bloques.
    const antes = bloquesRecordados('contrato', DEFECTO, 'u1');
    antes.alternar('cuotas');   // lo cierra
    antes.alternar('resumen');  // lo cierra

    // Tres meses después se agrega un bloque que arranca abierto.
    const conBloqueNuevo = { ...DEFECTO, liquidaciones: true };
    const despues = bloquesRecordados('contrato', conBloqueNuevo, 'u1');

    // Éste es el bug que la regla 1 evita: con el estado completo guardado, el
    // bloque nuevo no estaría en el almacén… pero tampoco lo estarían sus
    // hermanos, y el merge lo dejaría cerrado. Acá llega con su default.
    expect(despues.abiertos.value.liquidaciones).toBe(true);
    // Y lo que la persona sí decidió se respeta.
    expect(despues.abiertos.value.cuotas).toBe(false);
    expect(despues.abiertos.value.resumen).toBe(false);
    // Lo que nunca tocó sigue con su default.
    expect(despues.abiertos.value.aumentos).toBe(true);
    expect(despues.abiertos.value.garantes).toBe(false);
  });

  it('volver al defecto borra la entrada entera, no escribe siete `false`', () => {
    const b = bloquesRecordados('contrato', DEFECTO, 'u1');
    b.alternar('garantes');
    expect(localStorage.getItem(clave('u1'))).not.toBeNull();

    b.volverAlDefecto();

    expect(localStorage.getItem(clave('u1'))).toBeNull();
    expect(b.abiertos.value).toEqual(DEFECTO);
    expect(b.hayPreferencia()).toBe(false);
  });
});

describe('bloques.ts · regla 2 — por USUARIO, no por navegador', () => {
  it('dos personas en la misma máquina no comparten la preferencia', () => {
    // La PC del mostrador es una y las personas son tres. Que el titular cierre
    // Cuotas y el asesor la encuentre cerrada es el bug: se buscaría la cobranza
    // en una pantalla que no la muestra.
    const titular = bloquesRecordados('contrato', DEFECTO, 'titular');
    titular.alternar('cuotas');
    expect(titular.abiertos.value.cuotas).toBe(false);

    const asesor = bloquesRecordados('contrato', DEFECTO, 'asesor');
    expect(asesor.abiertos.value.cuotas).toBe(true);

    // Y son dos entradas distintas, no una pisando a la otra.
    expect(localStorage.getItem(clave('titular'))).not.toBeNull();
    expect(localStorage.getItem(clave('asesor'))).toBeNull();
  });

  it('sin usuario todavía cargado escribe bajo una clave aparte y no bajo la de nadie', () => {
    // El store llena `usuario` async. Si esto guardara en la clave "pelada", la
    // sesión con usuario nunca lo leería y parecería que no se acuerda.
    const b = bloquesRecordados('contrato', DEFECTO, null);
    b.alternar('garantes');

    expect(localStorage.getItem('bemo_inmo_bloques_contrato_anonimo')).not.toBeNull();
    expect(localStorage.getItem('bemo_inmo_bloques_contrato_')).toBeNull();
    expect(localStorage.getItem('bemo_inmo_bloques_contrato')).toBeNull();
  });
});

describe('bloques.ts · regla 3 — un id que ya no existe se descarta en silencio', () => {
  it('la preferencia de un bloque que la ficha ya no dibuja no rompe ni reaparece', () => {
    // El caso real: se guardó `cuotas` y después se mira un contrato de
    // intermediación, que no tiene bloque de cuotas.
    localStorage.setItem(
      clave('u1'),
      JSON.stringify({ cuotas: false, bloqueQueYaNoExiste: true }),
    );

    const sinCuotas = { resumen: true, aumentos: true };
    const b = bloquesRecordados('contrato', sinCuotas, 'u1');

    expect(Object.keys(b.abiertos.value).sort()).toEqual(['aumentos', 'resumen']);
    expect(b.abiertos.value).not.toHaveProperty('bloqueQueYaNoExiste');
    // Y como no quedó nada tocado que aplique, tampoco se ofrece «volver».
    expect(b.hayPreferencia()).toBe(false);
  });

  it('un valor que no es booleano se ignora en vez de dejar la ficha en un estado raro', () => {
    localStorage.setItem(clave('u1'), JSON.stringify({ garantes: 'sí', cuotas: false }));

    const b = bloquesRecordados('contrato', DEFECTO, 'u1');

    expect(b.abiertos.value.garantes).toBe(false); // su default
    expect(b.abiertos.value.cuotas).toBe(false);   // lo guardado, que sí era válido
  });

  it('fijar un id que no está en los defaults no inventa un bloque', () => {
    const b = bloquesRecordados('contrato', DEFECTO, 'u1');
    b.fijar('inventado', true);

    expect(b.abiertos.value).not.toHaveProperty('inventado');
    expect(localStorage.getItem(clave('u1'))).toBeNull();
  });
});

describe('bloques.ts · regla 4 — un localStorage que falla no rompe la pantalla', () => {
  it('leer con JSON corrupto devuelve los defaults en vez de tirar', () => {
    localStorage.setItem(clave('u1'), 'esto no es json {{{');

    const b = bloquesRecordados('contrato', DEFECTO, 'u1');

    expect(b.abiertos.value).toEqual(DEFECTO);
  });

  it('escribir en modo privado de Safari no voltea la ficha', () => {
    // Safari privado tira al escribir. Una preferencia que no se recuerda es una
    // molestia; una ficha en blanco es un bug.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const b = bloquesRecordados('contrato', DEFECTO, 'u1');

    expect(() => b.alternar('garantes')).not.toThrow();
    // Y en esta sesión el bloque igual se abrió: lo que se pierde es la memoria,
    // no el uso.
    expect(b.abiertos.value.garantes).toBe(true);
  });

  it('leer con getItem roto tampoco rompe', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => bloquesRecordados('contrato', DEFECTO, 'u1')).not.toThrow();
  });
});

describe('bloques.ts · abrir y cerrar todo, y la apertura de cortesía', () => {
  it('«Abrir todo» y «Cerrar todo» sí escriben: eso lo decidió la persona', () => {
    const b = bloquesRecordados('contrato', DEFECTO, 'u1');
    b.cerrarTodos();

    expect(b.cerrados()).toBe(Object.keys(DEFECTO).length);
    const guardado = JSON.parse(localStorage.getItem(clave('u1'))!);
    expect(Object.keys(guardado).sort()).toEqual(Object.keys(DEFECTO).sort());

    b.abrirTodos();
    expect(b.cerrados()).toBe(0);
  });

  it('`?nuevo=1` abre sin escribir la preferencia', () => {
    const b = bloquesRecordados('contrato', DEFECTO, 'u1');
    b.abrirDeCortesia(['garantes', 'comision', 'documentos']);

    expect(b.abiertos.value.garantes).toBe(true);
    expect(b.abiertos.value.comision).toBe(true);
    expect(b.abiertos.value.documentos).toBe(true);

    // Lo importante: NO quedó guardado. Si se guardara, la próxima ficha —la de
    // un contrato de hace dos años— abriría con tres bloques que nadie pidió.
    expect(localStorage.getItem(clave('u1'))).toBeNull();
    expect(b.hayPreferencia()).toBe(false);

    const otraVisita = bloquesRecordados('contrato', DEFECTO, 'u1');
    expect(otraVisita.abiertos.value.garantes).toBe(false);
  });

  it('la cortesía NO pisa lo que la persona decidió cerrar', () => {
    const b = bloquesRecordados('contrato', DEFECTO, 'u1');
    b.fijar('garantes', false); // lo cerró a propósito

    b.abrirDeCortesia(['garantes', 'comision']);

    expect(b.abiertos.value.garantes).toBe(false); // su decisión manda
    expect(b.abiertos.value.comision).toBe(true);  // sobre éste no había opinión
  });
});
