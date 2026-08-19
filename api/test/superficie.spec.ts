import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PUBLICO, ROLES } from '../src/auth/decoradores';
import { resetEnvCache } from '../src/config/env';

/**
 * La superficie expuesta, revisada por el propio arranque de la app.
 *
 * ── Qué problema resuelve ──
 *
 * El guard es default-deny para AUTENTICACIÓN: sin `@Publico` hace falta token,
 * así que un endpoint nuevo nace cerrado. Pero para AUTORIZACIÓN el default es
 * al revés: sin `@Roles`, cualquier rol autenticado entra. Un endpoint de
 * escritura al que se le olvidó el decorador queda abierto al contable, al
 * asesor y a todos —y mirando el código no se nota, porque «sin `@Roles`» se ve
 * igual cuando fue una decisión que cuando fue un olvido—.
 *
 * ── Por qué NO hay un inventario de las 199 rutas ──
 *
 * Se probó: 70 no llevan `@Roles`, casi todas GET, porque los cuatro roles
 * trabajan en la misma inmobiliaria y leer lo de uno es leer lo de todos. Una
 * lista de 70 líneas que hay que tocar en cada endpoint nuevo se actualiza en
 * automático sin leerla, y un test que se actualiza sin leerlo no verifica
 * nada. Quedan las dos reglas que sí duelen si se rompen.
 *
 * Se lee de los metadatos y no del código fuente: un grep se rompe con un
 * salto de línea distinto, y esto pregunta lo que el framework realmente
 * registró.
 */

interface Ruta {
  verbo: string;
  camino: string;
  roles: string[] | undefined;
  publico: boolean;
}

describe('Superficie expuesta', () => {
  let rutas: Ruta[] = [];

  beforeAll(async () => {
    resetEnvCache();
    const mod = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();

    const disc = mod.get(DiscoveryService);

    for (const w of disc.getControllers()) {
      const ctor = w.metatype as (new (...a: never[]) => unknown) | undefined;
      if (!ctor) continue;
      const base = (Reflect.getMetadata(PATH_METADATA, ctor) as string) ?? '';
      const proto = ctor.prototype as Record<string, unknown>;

      for (const nombre of Object.getOwnPropertyNames(proto)) {
        if (nombre === 'constructor') continue;
        const fn = proto[nombre];
        if (typeof fn !== 'function') continue;

        const sufijo = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
        if (sufijo === undefined) continue; // no es un handler de ruta

        const verbo = RequestMethod[
          Reflect.getMetadata(METHOD_METADATA, fn) as number
        ] as string;

        rutas.push({
          verbo,
          camino: `/${base}${sufijo && sufijo !== '/' ? `/${sufijo}` : ''}`.replace(/\/+/g, '/'),
          roles:
            (Reflect.getMetadata(ROLES, fn) as string[] | undefined) ??
            (Reflect.getMetadata(ROLES, ctor) as string[] | undefined),
          publico:
            (Reflect.getMetadata(PUBLICO, fn) as boolean | undefined) ??
            (Reflect.getMetadata(PUBLICO, ctor) as boolean | undefined) ??
            false,
        });
      }
    }
    rutas.sort((a, b) => `${a.camino}${a.verbo}`.localeCompare(`${b.camino}${b.verbo}`));
  }, 60_000);

  it('encuentra las rutas — si esto da cero, el test no está probando nada', () => {
    // Un enumerador roto devuelve una lista vacía y TODAS las reglas de abajo
    // pasan por vacuidad. Es la falla más peligrosa que puede tener este
    // archivo, así que se chequea primero.
    expect(rutas.length).toBeGreaterThan(150);
  });

  /**
   * Regla 1 — lo que escribe, declara quién.
   *
   * GET queda afuera a propósito: leer es de todos y exigir el decorador ahí
   * sería ruido en 66 lugares. Todo lo demás cambia el estado de una
   * inmobiliaria y tiene que decir de quién es esa capacidad, aunque la
   * respuesta sea «de los cuatro roles» —escribirlo es lo que distingue la
   * decisión del olvido—.
   */
  it('toda ruta que escribe declara sus roles', () => {
    const sinDeclarar = rutas
      .filter((r) => r.verbo !== 'GET' && !r.publico && !r.roles?.length)
      .map((r) => `${r.verbo} ${r.camino}`);

    expect(sinDeclarar).toEqual([]);
  });

  /**
   * Regla 2 — la lista de lo público es cerrada.
   *
   * Es la única categoría donde un descuido se paga con datos afuera, sin
   * token. Doce rutas, cada una con su motivo; la trece tiene que costar
   * escribirla acá.
   */
  it('las rutas públicas son exactamente estas doce', () => {
    const publicas = rutas.filter((r) => r.publico).map((r) => `${r.verbo} ${r.camino}`).sort();

    expect(publicas).toEqual([
      // Alta de una inmobiliaria y entrada al sistema.
      'POST /auth/registrar',
      'POST /auth/login',
      'POST /auth/refresh',
      'POST /auth/logout',
      'POST /auth/invitacion/aceptar',
      // Los portales sin sesión: el token del enlace ES la credencial.
      'GET /propietario/:token',
      'GET /inquilino/:token',
      'POST /inquilino/:token/reclamos',
      // El feed que consumen los portales inmobiliarios.
      'GET /feed/:token.xml',
      // El catálogo de planes: es la página de precios.
      'GET /planes',
      // Sondas de vida. No devuelven dato de nadie.
      'GET /health',
      'GET /health/live',
    ].sort());
  });
});
