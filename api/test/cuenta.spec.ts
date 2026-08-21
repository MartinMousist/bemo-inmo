import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';
import { MODULOS, estadoDeModulos, modulosActivos } from '../src/cuenta/modulos.motor';

/**
 * El tipo de cuenta: inmobiliaria o gestión de alquileres.
 *
 * La regla vive en `modulos.motor.ts` y es pura, así que la mayor parte se
 * prueba sin base. Contra Postgres van los permisos, el aislamiento y que la
 * excepción se guarde como excepción y no como lista.
 */
describe('Tipo de cuenta y módulos', () => {
  // ── El motor, sin base ─────────────────────────────────────────────────────

  describe('qué ve cada tipo', () => {
    it('una inmobiliaria ve los cinco módulos opcionales', () => {
      expect(modulosActivos('inmobiliaria')).toEqual(MODULOS.map((m) => m.clave));
    });

    it('un gestor de alquileres no ve ninguno de los que elige', () => {
      // Su trabajo es cobrar el 1, liquidarle al propietario y que no se le
      // venza una garantía. Nada de eso es «leads» ni «comisiones».
      //
      // Sin plan declarado, los FIJOS sí están: no son una preferencia suya
      // sino algo que decide el plan, y sin plan no hay nada que filtrar. Que
      // un gestor no vea Liquidaciones sería absurdo: es su trabajo entero.
      const activos = modulosActivos('gestor');
      expect(activos).not.toContain('leads');
      expect(activos).not.toContain('ventas');
      expect(activos).not.toContain('comisiones');
      expect(activos).toContain('liquidaciones');
      expect(activos).toContain('portal');
    });

    it('la excepción gana sobre el tipo, en los dos sentidos', () => {
      expect(modulosActivos('gestor', ['ventas'])).toContain('ventas');
      expect(modulosActivos('inmobiliaria', [], ['publicaciones']))
        .not.toContain('publicaciones');
    });

    it('el plan manda por encima del tipo', () => {
      // Si el interruptor de una pantalla pudiera prender algo que el plan no
      // incluye, saltearía la facturación.
      const estado = estadoDeModulos('inmobiliaria', ['comisiones'], [], [
        'propiedades', 'personas', 'oportunidades', 'contratos',
      ]);
      const comisiones = estado.find((m) => m.clave === 'comisiones')!;
      expect(comisiones.activo).toBe(false);
      expect(comisiones.motivo).toBe('fuera-del-plan');
    });

    it('el plan y el menú usan las MISMAS claves, sin traducción', () => {
      // Antes el plan decía `oportunidades` donde el menú dice `leads`, y una
      // función traducía. Desde la migración 044 son la misma palabra: si el
      // plan trae `leads`, el módulo está; si trae el nombre viejo, no.
      const conNuevo = estadoDeModulos('inmobiliaria', [], [], ['leads']);
      expect(conNuevo.find((m) => m.clave === 'leads')!.activo).toBe(true);

      const conViejo = estadoDeModulos('inmobiliaria', [], [], ['oportunidades']);
      expect(conViejo.find((m) => m.clave === 'leads')!.activo).toBe(false);
    });

    it('un módulo fijo no se apaga con el interruptor: se cambia de plan', () => {
      // `liquidaciones` en `off` no hace nada. Apagar la rendición mensual no
      // es una preferencia razonable, y ofrecerla como tal sería una forma de
      // que alguien se rompa el mes sin querer.
      const estado = estadoDeModulos('inmobiliaria', [], ['liquidaciones'], null);
      expect(estado.find((m) => m.clave === 'liquidaciones')!.activo).toBe(true);

      // Fuera del plan sí desaparece, y con su motivo.
      const sinPlan = estadoDeModulos('inmobiliaria', [], [], ['leads']);
      const liq = sinPlan.find((m) => m.clave === 'liquidaciones')!;
      expect(liq.activo).toBe(false);
      expect(liq.motivo).toBe('fuera-del-plan');
    });

    it('sin plan declarado no se filtra nada', () => {
      // `undefined` es «no hay límite que aplicar»; `[]` sería un plan que no
      // incluye nada. Confundirlos dejaría sin módulos a una cuenta sin
      // suscripción cargada.
      expect(modulosActivos('inmobiliaria', [], [], undefined)).toHaveLength(MODULOS.length);
      expect(modulosActivos('inmobiliaria', [], [], [])).toHaveLength(0);
    });
  });

  // ── Contra Postgres ────────────────────────────────────────────────────────

  describe('la cuenta, de punta a punta', () => {
    let app: INestApplication;
    let inmo: Inmobiliaria;
    let otra: Inmobiliaria;

    const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
      auth(i.tokens[rol]);
    const http = () => request(app.getHttpServer());

    beforeAll(async () => {
      await limpiarFixtures();
      app = await crearApp();
      const tk = app.get(TokensService);
      inmo = await crearInmobiliaria('cuenta', tk);
      otra = await crearInmobiliaria('cuentavecina', tk);
    }, 60_000);

    afterAll(async () => {
      await app?.close();
      await limpiarFixtures();
    });

    afterEach(async () => {
      await http().put('/v1/cuenta/tipo').set(...como(inmo)).send({ tipo: 'inmobiliaria' });
    });

    it('una cuenta nueva es inmobiliaria', async () => {
      const r = await http().get('/v1/cuenta').set(...como(inmo)).expect(200);
      expect(r.body.tipo).toBe('inmobiliaria');
      expect(r.body.activos).toContain('ventas');
    });

    it('pasar a gestor esconde los cinco que se eligen, y deja los del plan', async () => {
      const r = await http().put('/v1/cuenta/tipo').set(...como(inmo))
        .send({ tipo: 'gestor' }).expect(200);

      // Los cinco electivos se van: un gestor no capta, no vende y no reparte
      // comisiones.
      for (const c of ['leads', 'ventas', 'reservas', 'comisiones', 'publicaciones']) {
        expect(r.body.activos).not.toContain(c);
      }
      // Los que decide el plan se quedan: liquidarle al propietario ES su
      // trabajo, y esconderlo por elegir «gestor» sería vaciarle la app.
      expect(r.body.activos).toContain('liquidaciones');
      expect(r.body.tipoTexto).toBe('Gestión de alquileres');
    });

    it('un gestor puede prender Ventas sin dejar de ser gestor', async () => {
      await http().put('/v1/cuenta/tipo').set(...como(inmo)).send({ tipo: 'gestor' }).expect(200);
      const r = await http().put('/v1/cuenta/modulos/ventas').set(...como(inmo))
        .send({ activo: true }).expect(200);

      expect(r.body.tipo).toBe('gestor');
      expect(r.body.activos).toContain('ventas');
      expect(r.body.modulos.find((m: { clave: string }) => m.clave === 'ventas').motivo)
        .toBe('prendido');
    });

    it('volver al estado del tipo borra la excepción en vez de guardarla', async () => {
      // Si la excepción quedara escrita, el día que el producto cambie lo que
      // trae cada tipo, esta cuenta no lo heredaría nunca.
      await http().put('/v1/cuenta/modulos/ventas').set(...como(inmo))
        .send({ activo: false }).expect(200);
      const r = await http().put('/v1/cuenta/modulos/ventas').set(...como(inmo))
        .send({ activo: true }).expect(200);

      expect(r.body.modulos.find((m: { clave: string }) => m.clave === 'ventas').motivo)
        .toBe('tipo');
    });

    it('apagar no borra: el tipo se cambia y vuelve con todo', async () => {
      await http().put('/v1/cuenta/tipo').set(...como(inmo)).send({ tipo: 'gestor' }).expect(200);
      const r = await http().put('/v1/cuenta/tipo').set(...como(inmo))
        .send({ tipo: 'inmobiliaria' }).expect(200);
      expect(r.body.activos).toHaveLength(MODULOS.length);
    });

    it('un módulo inventado no se puede tocar', async () => {
      await http().put('/v1/cuenta/modulos/contratos').set(...como(inmo))
        .send({ activo: false }).expect(422);
    });

    it('la lee todo el equipo y la escribe sólo el titular', async () => {
      // La lee cualquiera porque el front arma el menú con esto: un asesor que
      // no pudiera leerla vería la barra lateral vacía.
      await http().get('/v1/cuenta').set(...como(inmo, 'agente')).expect(200);
      await http().get('/v1/cuenta').set(...como(inmo, 'contable')).expect(200);

      await http().put('/v1/cuenta/tipo').set(...como(inmo, 'admin'))
        .send({ tipo: 'gestor' }).expect(403);
      await http().put('/v1/cuenta/modulos/ventas').set(...como(inmo, 'agente'))
        .send({ activo: false }).expect(403);
    });

    it('cada inmobiliaria tiene la suya', async () => {
      await http().put('/v1/cuenta/tipo').set(...como(inmo)).send({ tipo: 'gestor' }).expect(200);
      const vecina = await http().get('/v1/cuenta').set(...como(otra)).expect(200);
      expect(vecina.body.tipo).toBe('inmobiliaria');
    });

    it('el signup elige el tipo', async () => {
      const r = await http().post('/v1/auth/registrar')
        .send({
          // El nombre va con el prefijo `TEST_` y el mail en `@test.local`:
          // son los dos patrones que `limpiarFixtures()` borra. Sin eso, la
          // segunda corrida de esta suite choca contra `usuario_email_key` y
          // falla con un 409 que no tiene nada que ver con lo que se prueba.
          inmobiliaria: 'TEST_Gestión Cuyo', tipo: 'gestor',
          nombre: 'Quien Gestiona', email: 'gestion@test.local',
          password: 'unaclavelarga1',
        })
        .expect(201);

      const cuenta = await http().get('/v1/cuenta')
        .set('Authorization', `Bearer ${r.body.accessToken}`).expect(200);
      expect(cuenta.body.tipo).toBe('gestor');
      expect(cuenta.body.activos).not.toContain('leads');
      expect(cuenta.body.activos).not.toContain('comisiones');
    });
  });
});
