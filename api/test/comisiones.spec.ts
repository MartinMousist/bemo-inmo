import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { TokensService } from '../src/auth/tokens.service';
import { loadEnv } from '../src/config/env';
import {
  auth,
  crearApp,
  crearInmobiliaria,
  limpiarFixtures,
  type Inmobiliaria,
} from './util';

/**
 * Comisiones: compartir con otra inmobiliaria, el % por agente, el % por
 * propiedad, la sugerencia de reparto, la comisión del alquiler y el perfil.
 *
 * Todo contra Postgres real, con las mismas migraciones que producción. Lo que
 * se prueba acá es lo que estaba en la base y no leía nadie: las dos columnas
 * de `membresia` (017), `propiedad.agente_captador_id` (006),
 * `operacion.comision_config` (006) y `comision.contrato_id` (008).
 */
describe('Comisiones', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let otra: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('comis', tk);
    otra = await crearInmobiliaria('comisvecina', tk);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  const CONFIG_BASE = {
    venta: { compradora: 3, vendedora: 3 },
    alquiler: { locataria: 0, locadora: 100 },
    repartoInterno: { captador: 25, cerrador: 25 },
  };

  /** Una propiedad con su operación de venta y, si se pide, su captador. */
  async function crearPropiedadVenta(
    precio = 200000,
    captadorId?: string,
    quien: Inmobiliaria = inmo,
  ) {
    const prop = await http().post('/v1/propiedades').set(...como(quien))
      .send({
        calle: `Comis ${Math.random().toString(36).slice(2, 8)}`,
        tipo: 'casa',
        ...(captadorId ? { agenteCaptadorId: captadorId } : {}),
      })
      .expect(201);

    const op = await http().post(`/v1/propiedades/${prop.body.id}/operaciones`)
      .set(...como(quien))
      .send({ tipo: 'venta', precio, moneda: 'USD', estado: 'disponible' })
      .expect(201);

    return {
      propiedadId: prop.body.id,
      operacionId: op.body.operaciones[0].id,
    };
  }

  async function crearVenta(precio = 200000, captadorId?: string) {
    const { operacionId, propiedadId } = await crearPropiedadVenta(precio, captadorId);
    const v = await http().post('/v1/ventas').set(...como(inmo))
      .send({ operacionId, precioCierre: precio, moneda: 'USD' })
      .expect(201);
    return { venta: v.body, operacionId, propiedadId };
  }

  // ══ 1 · Compartir con otra inmobiliaria ═══════════════════════════════════

  describe('compartir con otra inmobiliaria', () => {
    it('el catálogo arranca vacío y el alta lo llena', async () => {
      const vacio = await http().get('/v1/comisiones/externas').set(...como(inmo)).expect(200);
      expect(vacio.body).toEqual([]);

      const r = await http().post('/v1/comisiones/externas').set(...como(inmo))
        .send({ nombre: 'Colega SRL', cuit: '30111111118', contacto: 'Vanina' })
        .expect(201);

      expect(r.body.nombre).toBe('Colega SRL');
      expect(r.body.activa).toBe(true);
      // Todavía no cobró nada: un array vacío, no un cero. Un cero en una
      // pantalla de plata es distinto de «nunca cobró».
      expect(r.body.pagado).toEqual([]);
    });

    it('el mismo nombre con otra capitalización es la MISMA agencia', async () => {
      await http().post('/v1/comisiones/externas').set(...como(inmo))
        .send({ nombre: 'Repetida Propiedades' }).expect(201);

      const r = await http().post('/v1/comisiones/externas').set(...como(inmo))
        .send({ nombre: 'repetida propiedades' }).expect(409);

      // Sin el UNIQUE sobre lower(nombre), «cuánto le pagamos a Repetida» daría
      // dos números distintos según cómo lo escribió cada uno.
      expect(r.body.detail).toContain('Ya tenés cargada');
    });

    it('un asesor la puede dar de alta, pero no de baja', async () => {
      const r = await http().post('/v1/comisiones/externas').set(...como(inmo, 'agente'))
        .send({ nombre: 'Alta Del Asesor' }).expect(201);

      // Quien cierra una operación compartida a las siete de la tarde no puede
      // quedar trabado esperando al titular.
      await http().patch(`/v1/comisiones/externas/${r.body.id}`).set(...como(inmo, 'agente'))
        .send({ activa: false }).expect(403);

      await http().patch(`/v1/comisiones/externas/${r.body.id}`).set(...como(inmo))
        .send({ activa: false }).expect(200);
    });

    it('dar de baja la esconde del catálogo pero no borra el histórico', async () => {
      const e = await http().post('/v1/comisiones/externas').set(...como(inmo))
        .send({ nombre: 'Se Va A Dar De Baja' }).expect(201);

      const { venta } = await crearVenta(100000);
      await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
        .send({
          puntas: { vendedora: 3 },
          externas: { vendedora: { nombre: 'Se Va A Dar De Baja', porcentaje: 50, externaId: e.body.id } },
        }).expect(201);

      await http().patch(`/v1/comisiones/externas/${e.body.id}`).set(...como(inmo))
        .send({ activa: false }).expect(200);

      const activas = await http().get('/v1/comisiones/externas').set(...como(inmo)).expect(200);
      expect(activas.body.map((x: { id: string }) => x.id)).not.toContain(e.body.id);

      const todas = await http().get('/v1/comisiones/externas?todas=true')
        .set(...como(inmo)).expect(200);
      const laBaja = todas.body.find((x: { id: string }) => x.id === e.body.id);
      // Lo que se le pagó sigue estando: un DELETE se lo habría llevado puesto
      // (la FK es ON DELETE SET NULL) y con él la única forma de sumarlo.
      expect(laBaja.pagado[0].total).toBe(1500);
    });

    it('la comisión guarda el id de la ficha Y el nombre congelado', async () => {
      const e = await http().post('/v1/comisiones/externas').set(...como(inmo))
        .send({ nombre: 'Nombre Original' }).expect(201);

      const { venta } = await crearVenta(200000);
      const r = await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
        .send({
          puntas: { vendedora: 3 },
          externas: { vendedora: { nombre: 'Nombre Original', porcentaje: 50, externaId: e.body.id } },
        }).expect(201);

      const linea = r.body.comisiones.find(
        (c: { beneficiarioTipo: string }) => c.beneficiarioTipo === 'inmobiliaria_externa',
      );
      expect(linea.externaId).toBe(e.body.id);

      // Se le cambia el nombre a la ficha…
      await http().patch(`/v1/comisiones/externas/${e.body.id}`).set(...como(inmo))
        .send({ nombre: 'Nombre Nuevo' }).expect(200);

      // …y la comisión sigue diciendo a quién se le pagó. Misma regla que el
      // ajuste confirmado: lo que salió es lo que salió.
      const despues = await http().get(`/v1/ventas/${venta.id}`).set(...como(inmo)).expect(200);
      const misma = despues.body.comisiones.find(
        (c: { beneficiarioTipo: string }) => c.beneficiarioTipo === 'inmobiliaria_externa',
      );
      expect(misma.beneficiarioNombre).toBe('Nombre Original');
    });

    it('compartir una punta que no cobra es 422 con el motivo', async () => {
      const { venta } = await crearVenta(200000);
      const r = await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
        .send({
          puntas: { compradora: 3 },
          externas: { vendedora: { nombre: 'Fantasma', porcentaje: 50 } },
        })
        .expect(422);

      // Sin este corte el motor calcula 0 × 50% = 0, no emite línea, y el
      // reparto sale prolijo SIN la agencia con la que se acordó 50/50.
      expect(r.body.detail).toContain('no cobra honorarios');
    });

    it('una punta inventada es 400, no un 500 de la base', async () => {
      const { venta } = await crearVenta(100000);
      // Antes `puntas` era `@IsObject()` pelado: el valor llegaba al motor, se
      // armaba una fila con punta='foo' y cortaba la CHECK de Postgres.
      await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
        .send({ puntas: { foo: 3 } }).expect(400);
    });

    it('una externa sin nombre es 400, no un 500 de la base', async () => {
      const { venta } = await crearVenta(100000);
      await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
        .send({ puntas: { vendedora: 3 }, externas: { vendedora: { porcentaje: 50 } } })
        .expect(400);
    });

    it('la vecina no ve el catálogo ajeno', async () => {
      await http().post('/v1/comisiones/externas').set(...como(inmo))
        .send({ nombre: 'Secreto Comercial SA' }).expect(201);

      const r = await http().get('/v1/comisiones/externas?todas=true')
        .set(...como(otra)).expect(200);
      expect(r.body.map((x: { nombre: string }) => x.nombre))
        .not.toContain('Secreto Comercial SA');
    });
  });

  // ══ 2 · El % por agente ═══════════════════════════════════════════════════

  describe('el % de cada agente', () => {
    afterEach(async () => {
      await http().patch(`/v1/equipo/${inmo.usuarios.agente}/comisiones`).set(...como(inmo))
        .send({ comisionCaptadorPct: null, comisionCerradorPct: null });
    });

    it('el listado trae el propio y el heredado', async () => {
      const r = await http().get('/v1/equipo').set(...como(inmo)).expect(200);

      const a = r.body.miembros.find(
        (m: { usuarioId: string }) => m.usuarioId === inmo.usuarios.agente,
      );
      // NULL no es cero: es «hereda el de la inmobiliaria», y por eso viaja
      // también el heredado — si no, la pantalla no puede decir cuánto cobra.
      expect(a.comisionCaptadorPct).toBeNull();
      expect(r.body.heredado).toEqual({ captador: 25, cerrador: 25 });
      expect(r.body.totalVenta).toBe(6);
    });

    it('se guarda, y volver a vaciarlo vuelve a heredar', async () => {
      await http().patch(`/v1/equipo/${inmo.usuarios.agente}/comisiones`).set(...como(inmo))
        .send({ comisionCaptadorPct: 30, comisionCerradorPct: 20 }).expect(200);

      const conValor = await http().get('/v1/equipo').set(...como(inmo)).expect(200);
      const a1 = conValor.body.miembros.find(
        (m: { usuarioId: string }) => m.usuarioId === inmo.usuarios.agente,
      );
      expect(a1.comisionCaptadorPct).toBe(30);

      // El caso que un coalesce haría imposible: volver de un override a
      // heredar. Con `coalesce($2, comision_captador_pct)` el 30 quedaría
      // clavado para siempre y el usuario vería que borrar el número no hace
      // nada.
      await http().patch(`/v1/equipo/${inmo.usuarios.agente}/comisiones`).set(...como(inmo))
        .send({ comisionCaptadorPct: null, comisionCerradorPct: null }).expect(200);

      const vacio = await http().get('/v1/equipo').set(...como(inmo)).expect(200);
      const a2 = vacio.body.miembros.find(
        (m: { usuarioId: string }) => m.usuarioId === inmo.usuarios.agente,
      );
      expect(a2.comisionCaptadorPct).toBeNull();
      expect(a2.comisionCerradorPct).toBeNull();
    });

    it('omitir un campo es 400: el front manda la fila entera', async () => {
      // `@IsOptional()` habría dejado pasar el campo ausente y, con el `?? null`
      // del controlador, un PATCH que sólo quiso tocar el captador le borraría
      // el override al cerrador sin decir nada.
      await http().patch(`/v1/equipo/${inmo.usuarios.agente}/comisiones`).set(...como(inmo))
        .send({ comisionCaptadorPct: 30 }).expect(400);
    });

    it('cero es un valor distinto de null', async () => {
      await http().patch(`/v1/equipo/${inmo.usuarios.agente}/comisiones`).set(...como(inmo))
        .send({ comisionCaptadorPct: 0, comisionCerradorPct: 40 }).expect(200);

      const r = await http().get('/v1/equipo').set(...como(inmo)).expect(200);
      const a = r.body.miembros.find(
        (m: { usuarioId: string }) => m.usuarioId === inmo.usuarios.agente,
      );
      // Cero = «no cobra por captar». Null = «cobra lo que diga la casa».
      expect(a.comisionCaptadorPct).toBe(0);
    });

    it('captar y cerrar no pueden pasar del 100', async () => {
      const r = await http().patch(`/v1/equipo/${inmo.usuarios.agente}/comisiones`)
        .set(...como(inmo))
        .send({ comisionCaptadorPct: 70, comisionCerradorPct: 40 }).expect(422);
      expect(r.body.detail).toContain('no le quedaría nada');
    });

    it('el asesor y el contable no lo pueden cambiar', async () => {
      await http().patch(`/v1/equipo/${inmo.usuarios.agente}/comisiones`)
        .set(...como(inmo, 'agente'))
        .send({ comisionCaptadorPct: 90, comisionCerradorPct: 0 }).expect(403);

      await http().patch(`/v1/equipo/${inmo.usuarios.agente}/comisiones`)
        .set(...como(inmo, 'contable'))
        .send({ comisionCaptadorPct: 90, comisionCerradorPct: 0 }).expect(403);
    });

    it('la vecina no le puede tocar el % a un agente ajeno', async () => {
      const r = await http().patch(`/v1/equipo/${inmo.usuarios.agente}/comisiones`)
        .set(...como(otra))
        .send({ comisionCaptadorPct: 99, comisionCerradorPct: 0 });
      // La RLS filtra la membresía por tenant: para la vecina esa persona no
      // existe. No es un 403 con la fila igual actualizada.
      expect(r.status).toBe(404);

      const mio = await http().get('/v1/equipo').set(...como(inmo)).expect(200);
      const a = mio.body.miembros.find(
        (m: { usuarioId: string }) => m.usuarioId === inmo.usuarios.agente,
      );
      expect(a.comisionCaptadorPct).not.toBe(99);
    });
  });

  // ══ 3 · El % por propiedad ════════════════════════════════════════════════

  describe('el % de cada propiedad', () => {
    it('sin override, la operación hereda el de la casa', async () => {
      const { propiedadId } = await crearPropiedadVenta();
      const p = await http().get(`/v1/propiedades/${propiedadId}`).set(...como(inmo)).expect(200);

      expect(p.body.operaciones[0].comision).toEqual({
        puntas: { compradora: 3, vendedora: 3 },
        total: 6,
        propio: false,
      });
    });

    it('con override parcial, la otra punta NO queda sin valor', async () => {
      // La trampa del spread de primer nivel: guardar `{"venta":{"compradora":4}}`
      // y mezclarlo de a un nivel dejaría `vendedora` en undefined, y el motor
      // calcularía una punta menos sin decir nada.
      const { propiedadId, operacionId } = await crearPropiedadVenta();

      await http().patch(`/v1/propiedades/${propiedadId}/operaciones/${operacionId}/comisiones`)
        .set(...como(inmo))
        .send({ venta: { compradora: 4, vendedora: 2 } }).expect(200);

      const p = await http().get(`/v1/propiedades/${propiedadId}`).set(...como(inmo)).expect(200);
      expect(p.body.operaciones[0].comision).toEqual({
        puntas: { compradora: 4, vendedora: 2 },
        total: 6,
        propio: true,
      });
    });

    it('mandar {} limpia el override y vuelve a heredar', async () => {
      const { propiedadId, operacionId } = await crearPropiedadVenta();

      await http().patch(`/v1/propiedades/${propiedadId}/operaciones/${operacionId}/comisiones`)
        .set(...como(inmo)).send({ venta: { compradora: 5, vendedora: 1 } }).expect(200);

      await http().patch(`/v1/propiedades/${propiedadId}/operaciones/${operacionId}/comisiones`)
        .set(...como(inmo)).send({}).expect(200);

      const p = await http().get(`/v1/propiedades/${propiedadId}`).set(...como(inmo)).expect(200);
      expect(p.body.operaciones[0].comision.propio).toBe(false);
      expect(p.body.operaciones[0].comision.total).toBe(6);
    });

    it('las dos puntas no pueden sumar más de 100', async () => {
      const { propiedadId, operacionId } = await crearPropiedadVenta();
      const r = await http()
        .patch(`/v1/propiedades/${propiedadId}/operaciones/${operacionId}/comisiones`)
        .set(...como(inmo)).send({ venta: { compradora: 80, vendedora: 40 } }).expect(422);
      expect(r.body.detail).toContain('100%');
    });

    it('el asesor y el contable no lo pueden cambiar', async () => {
      const { propiedadId, operacionId } = await crearPropiedadVenta();
      const url = `/v1/propiedades/${propiedadId}/operaciones/${operacionId}/comisiones`;

      await http().patch(url).set(...como(inmo, 'agente'))
        .send({ venta: { compradora: 9, vendedora: 1 } }).expect(403);
      await http().patch(url).set(...como(inmo, 'contable'))
        .send({ venta: { compradora: 9, vendedora: 1 } }).expect(403);
    });

    it('la vecina no puede tocar una operación ajena', async () => {
      const { propiedadId, operacionId } = await crearPropiedadVenta();
      await http().patch(`/v1/propiedades/${propiedadId}/operaciones/${operacionId}/comisiones`)
        .set(...como(otra)).send({ venta: { compradora: 9, vendedora: 1 } }).expect(404);
    });

    it('la propiedad devuelve quién la captó', async () => {
      // `agente_captador_id` se escribía desde la 006 y `selectPropiedad()`
      // nunca lo devolvía: el dato estaba y ninguna pantalla lo mostraba.
      const { propiedadId } = await crearPropiedadVenta(200000, inmo.usuarios.agente);
      const p = await http().get(`/v1/propiedades/${propiedadId}`).set(...como(inmo)).expect(200);

      expect(p.body.agenteCaptador.id).toBe(inmo.usuarios.agente);
      expect(p.body.agenteCaptador.nombre).toContain('agente');
    });
  });

  // ══ 4 · La sugerencia de reparto ══════════════════════════════════════════

  describe('la sugerencia de reparto', () => {
    afterEach(async () => {
      await http().put('/v1/comisiones/config').set(...como(inmo)).send(CONFIG_BASE);
      await http().patch(`/v1/equipo/${inmo.usuarios.agente}/comisiones`).set(...como(inmo))
        .send({ comisionCaptadorPct: null, comisionCerradorPct: null });
    });

    it('pre-llena puntas, captador y cerrador', async () => {
      const { venta } = await crearVenta(200000, inmo.usuarios.agente);
      const r = await http().get(`/v1/ventas/${venta.id}/reparto/sugerido`)
        .set(...como(inmo)).expect(200);

      expect(r.body.base).toBe(200000);
      expect(r.body.moneda).toBe('USD');
      expect(r.body.puntas).toEqual({ compradora: 3, vendedora: 3 });
      expect(r.body.puntasHeredadas).toBe(true);
      // El captador sale de la ficha de la propiedad…
      expect(r.body.captador.usuarioId).toBe(inmo.usuarios.agente);
      // …y el cerrador es quien está cargando el reparto.
      expect(r.body.cerrador.usuarioId).toBe(inmo.usuarios.owner);
    });

    it('sin captador en la ficha, la sugerencia lo dice con null', async () => {
      const { venta } = await crearVenta(150000);
      const r = await http().get(`/v1/ventas/${venta.id}/reparto/sugerido`)
        .set(...como(inmo)).expect(200);
      // `null` y no un agente cualquiera: la pantalla tiene que poder decir
      // «cargalo en la ficha» en vez de proponer a alguien que no captó.
      expect(r.body.captador).toBeNull();
    });

    it('el % del agente gana sobre el de la casa, y dice que es propio', async () => {
      await http().patch(`/v1/equipo/${inmo.usuarios.agente}/comisiones`).set(...como(inmo))
        .send({ comisionCaptadorPct: 40, comisionCerradorPct: 10 }).expect(200);

      const { venta } = await crearVenta(200000, inmo.usuarios.agente);
      const r = await http().get(`/v1/ventas/${venta.id}/reparto/sugerido`)
        .set(...como(inmo)).expect(200);

      expect(r.body.captador.porcentaje).toBe(40);
      expect(r.body.captador.propio).toBe(true);
      // El owner no tiene número propio: hereda el 25 de la casa.
      expect(r.body.cerrador.porcentaje).toBe(25);
      expect(r.body.cerrador.propio).toBe(false);
      expect(r.body.repartoInternoCasa).toEqual({ captador: 25, cerrador: 25 });
    });

    it('el % de la propiedad gana sobre el de la casa', async () => {
      const { operacionId, propiedadId } = await crearPropiedadVenta(300000);
      await http().patch(`/v1/propiedades/${propiedadId}/operaciones/${operacionId}/comisiones`)
        .set(...como(inmo)).send({ venta: { compradora: 2, vendedora: 4 } }).expect(200);

      const v = await http().post('/v1/ventas').set(...como(inmo))
        .send({ operacionId, precioCierre: 300000, moneda: 'USD' }).expect(201);

      const r = await http().get(`/v1/ventas/${v.body.id}/reparto/sugerido`)
        .set(...como(inmo)).expect(200);
      expect(r.body.puntas).toEqual({ compradora: 2, vendedora: 4 });
      expect(r.body.puntasHeredadas).toBe(false);
    });

    it('el override de una inmobiliaria no alcanza a la otra', async () => {
      await http().put('/v1/comisiones/config').set(...como(inmo))
        .send({ ...CONFIG_BASE, venta: { compradora: 5, vendedora: 1 } }).expect(200);

      const { venta } = await crearVenta(100000);
      const mio = await http().get(`/v1/ventas/${venta.id}/reparto/sugerido`)
        .set(...como(inmo)).expect(200);
      expect(mio.body.puntas).toEqual({ compradora: 5, vendedora: 1 });

      // La vecina sigue con su default.
      const suConfig = await http().get('/v1/comisiones/config').set(...como(otra)).expect(200);
      expect(suConfig.body.venta).toEqual({ compradora: 3, vendedora: 3 });
    });

    it('el asesor puede ver la sugerencia pero no guardar el reparto', async () => {
      const { venta } = await crearVenta(100000);
      await http().get(`/v1/ventas/${venta.id}/reparto/sugerido`)
        .set(...como(inmo, 'agente')).expect(200);
      await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo, 'agente'))
        .send({ puntas: { vendedora: 3 } }).expect(403);
    });

    it('la vecina no puede pedir la sugerencia de una venta ajena', async () => {
      const { venta } = await crearVenta(100000);
      await http().get(`/v1/ventas/${venta.id}/reparto/sugerido`).set(...como(otra)).expect(404);
    });
  });

  // ══ 5 · De quién es cada comisión ═════════════════════════════════════════

  describe('el detalle de la venta', () => {
    it('devuelve la memoria de cálculo de cada línea', async () => {
      const { venta } = await crearVenta(162000, inmo.usuarios.agente);
      await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
        .send({
          puntas: { vendedora: 3 },
          repartoInterno: {
            captador: { usuarioId: inmo.usuarios.agente, nombre: 'Asesor', porcentaje: 25 },
          },
        }).expect(201);

      const r = await http().get(`/v1/ventas/${venta.id}`).set(...como(inmo)).expect(200);

      const nivel1 = r.body.comisiones.find((c: { nivel: number }) => c.nivel === 1);
      expect(nivel1.memoria).toBe('USD 162.000 × 3 % = USD 4.860');
      expect(nivel1.base).toBe(4860 / 0.03);
      expect(nivel1.porcentaje).toBe(3);

      const delAgente = r.body.comisiones.find(
        (c: { beneficiarioTipo: string }) => c.beneficiarioTipo === 'agente',
      );
      expect(delAgente.memoria).toBe('USD 4.860 × 25 % = USD 1.215');
      // `beneficiarioId` y `padreId` hacen falta para rehidratar el formulario
      // y para armar el árbol; sin ellos la pantalla de detalle no se puede hacer.
      expect(delAgente.beneficiarioId).toBe(inmo.usuarios.agente);
      expect(delAgente.padreId).toBe(nivel1.id);
      expect(r.body.cuadra).toBe(true);
      expect(r.body.repartida).toBe(true);
    });

    it('devuelve quién captó, para poder mostrarlo al abrir la venta', async () => {
      const { venta } = await crearVenta(100000, inmo.usuarios.agente);
      const r = await http().get(`/v1/ventas/${venta.id}`).set(...como(inmo)).expect(200);
      expect(r.body.agenteCaptador.id).toBe(inmo.usuarios.agente);
    });

    it('`cobradaEl` no se corre un día', async () => {
      // Las columnas `date` de Postgres no tienen zona: pasarlas por `new Date()`
      // corre el día para atrás y una comisión cobrada el 01/01 se muestra del
      // 31/12.
      const { venta } = await crearVenta(100000);
      const r = await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
        .send({ puntas: { vendedora: 3 } }).expect(201);

      const laCasa = r.body.comisiones.find(
        (c: { beneficiarioTipo: string }) => c.beneficiarioTipo === 'casa',
      );
      await http().post(`/v1/comisiones/${laCasa.id}/cobrar`).set(...como(inmo))
        .send({ fecha: '2026-01-01' }).expect(201);

      const despues = await http().get(`/v1/ventas/${venta.id}`).set(...como(inmo)).expect(200);
      const cobrada = despues.body.comisiones.find(
        (c: { id: string }) => c.id === laCasa.id,
      );
      expect(cobrada.cobradaEl).toBe('2026-01-01');
    });

    it('una venta sin reparto no está «mal repartida»: está sin repartir', async () => {
      const { venta } = await crearVenta(100000);
      const r = await http().get(`/v1/ventas/${venta.id}`).set(...como(inmo)).expect(200);
      expect(r.body.repartida).toBe(false);
      // Cero comisiones cuadra: no hay plata perdida ni inventada.
      expect(r.body.cuadra).toBe(true);
    });
  });

  // ══ 6 · La comisión del alquiler ══════════════════════════════════════════

  describe('la comisión del alquiler', () => {
    async function crearContrato(monto = 400000, captadorId?: string) {
      const prop = await http().post('/v1/propiedades').set(...como(inmo))
        .send({
          calle: `Alq ${Math.random().toString(36).slice(2, 8)}`,
          tipo: 'departamento',
          ...(captadorId ? { agenteCaptadorId: captadorId } : {}),
        }).expect(201);

      const op = await http().post(`/v1/propiedades/${prop.body.id}/operaciones`)
        .set(...como(inmo))
        .send({ tipo: 'alquiler', precio: monto, moneda: 'ARS', estado: 'disponible' })
        .expect(201);

      const c = await http().post('/v1/contratos').set(...como(inmo))
        .send({
          propiedadId: prop.body.id,
          operacionId: op.body.operaciones[0].id,
          fechaInicio: '2026-01-01',
          fechaFin: '2028-12-31',
          montoInicial: monto,
          moneda: 'ARS',
          indice: 'ipc',
        }).expect(201);

      return {
        contratoId: c.body.id,
        propiedadId: prop.body.id,
        operacionId: op.body.operaciones[0].id,
        tenantId: inmo.tenantId,
      };
    }

    it('arranca sin comisión: se arma con un paso explícito', async () => {
      const { contratoId } = await crearContrato();
      const r = await http().get(`/v1/contratos/${contratoId}/comisiones`)
        .set(...como(inmo)).expect(200);

      // Generarla sola al firmar dejaría una comisión proyectada dando vueltas
      // por cada contrato cargado para probar. Ventas pide el mismo paso.
      expect(r.body.comisiones).toEqual([]);
      expect(r.body.repartida).toBe(false);
      expect(r.body.base).toBe(400000);
      expect(r.body.moneda).toBe('ARS');
    });

    it('la sugerencia usa la punta locadora al 100 y un mes de base', async () => {
      const { contratoId } = await crearContrato(500000, inmo.usuarios.agente);
      const r = await http().get(`/v1/contratos/${contratoId}/comisiones/sugerido`)
        .set(...como(inmo)).expect(200);

      expect(r.body.base).toBe(500000);
      expect(r.body.puntas).toEqual({ locataria: 0, locadora: 100 });
      expect(r.body.captador.usuarioId).toBe(inmo.usuarios.agente);
    });

    it('se reparte igual que una venta, y escribe contrato_id', async () => {
      const { contratoId } = await crearContrato(400000, inmo.usuarios.agente);

      const r = await http().post(`/v1/contratos/${contratoId}/comisiones`).set(...como(inmo))
        .send({
          puntas: { locadora: 100 },
          repartoInterno: {
            captador: { usuarioId: inmo.usuarios.agente, nombre: 'Asesor', porcentaje: 25 },
            cerrador: { usuarioId: inmo.usuarios.admin, nombre: 'Admin', porcentaje: 25 },
          },
        }).expect(201);

      expect(r.body.totales.operacion).toBe(400000);
      expect(r.body.totales.agentes).toBe(200000);
      expect(r.body.totales.casa).toBe(200000);
      expect(r.body.cuadra).toBe(true);

      // `comision.contrato_id` existe desde la 008 y no tenía un solo escritor.
      const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
      await c.connect();
      try {
        const { rows } = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM comision
            WHERE contrato_id = $1 AND venta_id IS NULL`,
          [contratoId],
        );
        expect(Number(rows[0].n)).toBe(4);
      } finally {
        await c.end();
      }
    });

    it('la base es el monto INICIAL, no la cuota vigente', async () => {
      const { contratoId, tenantId } = await crearContrato(300000);
      await http().post(`/v1/contratos/${contratoId}/comisiones`).set(...como(inmo))
        .send({ puntas: { locadora: 100 } }).expect(201);

      // Un aumento ya aplicado triplica el alquiler…
      const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
      await c.connect();
      try {
        await c.query(
          `INSERT INTO contrato_ajuste
             (tenant_id, contrato_id, vigente_desde, periodo_base, periodo_actual,
              indice_tipo, coeficiente, monto_anterior, monto_nuevo, moneda, memoria, estado)
           VALUES ($1,$2,current_date - 30,'2026-01-01','2026-04-01',
                   'porcentaje_fijo',3,300000,900000,'ARS','{}'::jsonb,'aplicado')`,
          [tenantId, contratoId],
        );
      } finally {
        await c.end();
      }

      const contrato = await http().get(`/v1/contratos/${contratoId}`)
        .set(...como(inmo)).expect(200);
      expect(contrato.body.montoVigente).toBe(900000);

      // …y la comisión NO se mueve. Si se calculara contra la cuota de hoy,
      // cada aumento por índice recalcularía una comisión que quizás ya se
      // cobró: el mismo principio del ajuste confirmado inmutable.
      const r = await http().get(`/v1/contratos/${contratoId}/comisiones`)
        .set(...como(inmo)).expect(200);
      expect(r.body.base).toBe(300000);
      expect(r.body.totales.operacion).toBe(300000);
    });

    it('una punta de venta en un alquiler es 422 con el motivo', async () => {
      const { contratoId } = await crearContrato();
      const r = await http().post(`/v1/contratos/${contratoId}/comisiones`).set(...como(inmo))
        .send({ puntas: { vendedora: 3 } }).expect(422);
      expect(r.body.detail).toContain('locataria');
    });

    it('con una comisión cobrada no se puede rehacer', async () => {
      const { contratoId } = await crearContrato();
      const r = await http().post(`/v1/contratos/${contratoId}/comisiones`).set(...como(inmo))
        .send({ puntas: { locadora: 100 } }).expect(201);

      const laCasa = r.body.comisiones.find(
        (c: { beneficiarioTipo: string }) => c.beneficiarioTipo === 'casa',
      );
      await http().post(`/v1/comisiones/${laCasa.id}/cobrar`).set(...como(inmo))
        .send({}).expect(201);

      const rehacer = await http().post(`/v1/contratos/${contratoId}/comisiones`)
        .set(...como(inmo)).send({ puntas: { locadora: 50 } }).expect(409);
      expect(rehacer.body.code).toBe('ESTADO_INVALIDO');
    });

    it('el asesor la ve pero no la arma', async () => {
      const { contratoId } = await crearContrato();
      await http().get(`/v1/contratos/${contratoId}/comisiones`)
        .set(...como(inmo, 'agente')).expect(200);
      await http().post(`/v1/contratos/${contratoId}/comisiones`).set(...como(inmo, 'agente'))
        .send({ puntas: { locadora: 100 } }).expect(403);
    });

    it('la vecina no ve la comisión de un contrato ajeno', async () => {
      const { contratoId } = await crearContrato();
      await http().get(`/v1/contratos/${contratoId}/comisiones`).set(...como(otra)).expect(404);
    });
  });

  // ══ 7 · El perfil del agente ══════════════════════════════════════════════

  describe('el perfil', () => {
    it('el agente ve SUS montos', async () => {
      const { venta } = await crearVenta(200000, inmo.usuarios.agente);
      await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(inmo))
        .send({
          puntas: { vendedora: 3 },
          repartoInterno: {
            captador: { usuarioId: inmo.usuarios.agente, nombre: 'Asesor', porcentaje: 25 },
          },
        }).expect(201);

      const r = await http().get(`/v1/equipo/${inmo.usuarios.agente}/perfil`)
        .set(...como(inmo, 'agente')).expect(200);

      expect(r.body.esPropio).toBe(true);
      expect(r.body.comisiones).not.toBeNull();
      expect(r.body.comisionesMotivo).toBeNull();
      // Agrupadas por moneda Y por estado, sin ningún total que las cruce: en
      // esta misma suite el agente cobró en USD por ventas y en ARS por un
      // alquiler, y sumarlos no significaría nada.
      expect(r.body.comisiones.some((c: { moneda: string }) => c.moneda === 'USD')).toBe(true);
      expect(r.body.comisiones.every(
        (c: { moneda: string; estado: string }) => c.moneda && c.estado,
      )).toBe(true);
    });

    it('el agente NO ve los montos de un compañero, y se le dice por qué', async () => {
      const r = await http().get(`/v1/equipo/${inmo.usuarios.admin}/perfil`)
        .set(...como(inmo, 'agente')).expect(200);

      // `null` y no `0`: un cero en una pantalla de plata es mentir.
      expect(r.body.comisiones).toBeNull();
      expect(r.body.comisionesMotivo).toContain('tus propios montos');
      // Lo no monetario sí lo ve: es información de trabajo.
      expect(Array.isArray(r.body.captadas)).toBe(true);
    });

    it('para el agente, el bloque de la casa es VOLUMEN y no plata de terceros', async () => {
      const r = await http().get(`/v1/equipo/${inmo.usuarios.agente}/perfil`)
        .set(...como(inmo, 'agente')).expect(200);

      // Con un equipo chico, «el pozo de la casa» menos «lo mío» ES «lo del
      // compañero». Un permiso que se esquiva restando no es un permiso.
      expect(r.body.inmobiliaria.comisionesDeAgentes).toBeNull();
      expect(r.body.inmobiliaria.comisionesMotivo).toContain('volumen');
      expect(typeof r.body.inmobiliaria.ventasCerradas).toBe('number');
      expect(Array.isArray(r.body.inmobiliaria.operado)).toBe(true);
    });

    it('el titular, administración y contaduría ven el pozo de la casa', async () => {
      for (const rol of ['owner', 'admin', 'contable'] as const) {
        const r = await http().get(`/v1/equipo/${inmo.usuarios.agente}/perfil`)
          .set(...como(inmo, rol)).expect(200);
        expect(r.body.comisiones).not.toBeNull();
        expect(r.body.inmobiliaria.comisionesDeAgentes).not.toBeNull();
      }
    });

    it('trae sus captaciones, sus contratos y sus ventas', async () => {
      const { propiedadId } = await crearVenta(180000, inmo.usuarios.agente);
      const r = await http().get(`/v1/equipo/${inmo.usuarios.agente}/perfil`)
        .set(...como(inmo)).expect(200);

      expect(r.body.captadas.map((c: { id: string }) => c.id)).toContain(propiedadId);
      expect(Array.isArray(r.body.contratos)).toBe(true);
      expect(Array.isArray(r.body.ventas)).toBe(true);
    });

    it('la vecina no puede abrir el perfil de un agente ajeno', async () => {
      await http().get(`/v1/equipo/${inmo.usuarios.agente}/perfil`)
        .set(...como(otra)).expect(404);
    });
  });

  // ══ 8 · Los datos del seed cuadran ════════════════════════════════════════

  /**
   * La invariante, sobre los datos que NO pasaron por `repartir()`.
   *
   * El seed entra por SQL directo, así que se saltea la validación del
   * servicio: diez de las once ventas de demostración tenían un árbol distinto
   * del que produce el motor y no cuadraban —PROP-0011 mostraba «Comisión USD
   * 4.860 / A la casa USD 4.860» con un agente llevándose 1.215—. Este test
   * existe para que no se vuelva a desviar.
   *
   * Corre como OWNER y mira TODOS los tenants: la RLS no aplica ahí, y es
   * exactamente lo que hace falta para auditar el seed.
   */
  it('ninguna operación de la base tiene plata perdida ni inventada', async () => {
    const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await c.connect();
    try {
      const { rows } = await c.query<{
        duenio: string; operacion: string; repartido: string;
      }>(
        `SELECT coalesce(venta_id::text, contrato_id::text) AS duenio,
                sum(monto) FILTER (WHERE beneficiario_tipo = 'operacion') AS operacion,
                sum(monto) FILTER (WHERE beneficiario_tipo <> 'operacion') AS repartido
           FROM comision
          WHERE estado <> 'anulada'
          GROUP BY 1
         HAVING sum(monto) FILTER (WHERE beneficiario_tipo <> 'operacion') IS NOT NULL
            AND round(sum(monto) FILTER (WHERE beneficiario_tipo <> 'operacion'), 2)
             <> round(sum(monto) FILTER (WHERE beneficiario_tipo = 'operacion'), 2)`,
      );
      expect(rows).toEqual([]);
    } finally {
      await c.end();
    }
  });
});
