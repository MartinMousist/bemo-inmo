import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * Que Inicio y el Tablero digan cosas distintas según qué clase de cuenta sea.
 *
 * Lo que se prueba acá y no en el motor: que los servicios efectivamente MIREN
 * el perfil. El motor puede estar perfecto y `resumen()` seguir devolviendo el
 * embudo a todo el mundo —que es exactamente lo que pasaba antes de esto.
 */
describe('Los dos perfiles: qué ve cada cuenta', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let gestor: Inmobiliaria;

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('perfilinmo', tk);
    gestor = await crearInmobiliaria('perfilgestor', tk);

    // La segunda pasa a gestión de alquileres por el mismo endpoint que usa la
    // pantalla de Ajustes: si el cambio de tipo se rompiera, este test cae.
    await http().put('/v1/cuenta/tipo').set(...como(gestor))
      .send({ tipo: 'gestor' }).expect(200);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  describe('Inicio', () => {
    it('la inmobiliaria conserva su embudo enfriándose', async () => {
      const r = await http().get('/v1/inicio').set(...como(inmo)).expect(200);
      expect(r.body.oportunidadesFrias).not.toBeNull();
      // Y no se le agrega el contador de vacías: su menú ya parte la cartera.
      expect(r.body.cartera.unidadesVacias).toBeNull();
    });

    it('al gestor le sale null, no una lista vacía', async () => {
      // La diferencia importa: `[]` dice «no tenés ninguna consulta fría» y es
      // mentira —no tiene consultas—; `null` dice «acá no se mide eso», y es la
      // pantalla la que decide no dibujar la tarjeta.
      const r = await http().get('/v1/inicio').set(...como(gestor)).expect(200);
      expect(r.body.oportunidadesFrias).toBeNull();
    });

    it('al gestor se le cuentan las unidades vacías', async () => {
      const r = await http().get('/v1/inicio').set(...como(gestor)).expect(200);
      expect(typeof r.body.cartera.unidadesVacias).toBe('number');
    });
  });

  describe('Tablero', () => {
    it('la inmobiliaria ve embudo, ranking y comisiones por cobrar', async () => {
      const r = await http().get('/v1/tablero').set(...como(inmo)).expect(200);
      expect(r.body.embudo).not.toBeNull();
      expect(r.body.negocio.porAgente).not.toBeNull();
      expect(r.body.negocio.comisionesPorCobrar).not.toBeNull();
    });

    it('al gestor se le van los tres', async () => {
      const r = await http().get('/v1/tablero').set(...como(gestor)).expect(200);
      expect(r.body.embudo).toBeNull();
      expect(r.body.negocio.porAgente).toBeNull();
      expect(r.body.negocio.comisionesPorCobrar).toBeNull();
    });

    it('los honorarios NO se le van: es de lo que vive', async () => {
      // `honorariosDevengados` incluye los de liquidación, que son su ingreso
      // propio. Que sea `[]` en una cuenta recién creada es correcto; lo que no
      // puede es faltar la clave.
      const r = await http().get('/v1/tablero').set(...como(gestor)).expect(200);
      expect(r.body.negocio).not.toBeNull();
      expect(Array.isArray(r.body.negocio.honorariosDevengados)).toBe(true);
    });
  });

  describe('el interruptor manda sobre el tipo', () => {
    it('un gestor que prende Leads recupera embudo y consultas frías', async () => {
      await http().put('/v1/cuenta/modulos/leads').set(...como(gestor))
        .send({ activo: true }).expect(200);

      const t = await http().get('/v1/tablero').set(...como(gestor)).expect(200);
      expect(t.body.embudo).not.toBeNull();
      const i = await http().get('/v1/inicio').set(...como(gestor)).expect(200);
      expect(i.body.oportunidadesFrias).not.toBeNull();

      // Y sigue sin lo de comisiones: prendió uno, no los cinco.
      expect(t.body.negocio.porAgente).toBeNull();

      await http().put('/v1/cuenta/modulos/leads').set(...como(gestor))
        .send({ activo: false }).expect(200);
    });

    it('una inmobiliaria que apaga Comisiones deja de ver el ranking', async () => {
      // El tipo sigue siendo inmobiliaria. Si la decisión mirara el tipo en vez
      // del módulo, esto seguiría mostrando el ranking y el interruptor de
      // Ajustes sería decorativo.
      await http().put('/v1/cuenta/modulos/comisiones').set(...como(inmo))
        .send({ activo: false }).expect(200);

      const r = await http().get('/v1/tablero').set(...como(inmo)).expect(200);
      expect(r.body.negocio.porAgente).toBeNull();
      expect(r.body.embudo).not.toBeNull();

      await http().put('/v1/cuenta/modulos/comisiones').set(...como(inmo))
        .send({ activo: true }).expect(200);
    });
  });

  describe('quién puede cambiarlo', () => {
    it('sólo el titular cambia el tipo de cuenta', async () => {
      // Es una decisión de negocio, no de operación: cambiarlo le apaga cinco
      // secciones a todo el equipo.
      await http().put('/v1/cuenta/tipo').set(...como(inmo, 'admin'))
        .send({ tipo: 'gestor' }).expect(403);
      await http().put('/v1/cuenta/tipo').set(...como(inmo, 'agente'))
        .send({ tipo: 'gestor' }).expect(403);
    });

    it('cambiar el tipo de una cuenta no toca a la otra', async () => {
      const r = await http().get('/v1/cuenta').set(...como(inmo)).expect(200);
      expect(r.body.tipo).toBe('inmobiliaria');
    });
  });
});
