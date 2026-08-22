import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import { DbService } from '../src/database/db.service';
import { VencimientosCron } from '../src/alquileres/vencimientos.cron';
import { auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria } from './util';

/**
 * Dar de baja: propiedades, contratos y personas.
 *
 * Las tres cosas tienen el mismo problema de fondo: **nada se borra**. Una
 * inmobiliaria maneja plata de terceros y contratos con efecto legal, así que
 * lo que pasó tiene que poder mirarse dentro de cinco años. Lo que cambia es el
 * ESTADO, y esta suite es la lista de casos que ese cambio tiene que respetar.
 */
describe('Bajas: archivar, vencer y marcar', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let db: DbService;
  let cron: VencimientosCron;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    inmo = await crearInmobiliaria('bajas', app.get(TokensService));
    db = app.get(DbService);
    cron = app.get(VencimientosCron);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  const enAnios = (n: number) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + n);
    return d.toISOString().slice(0, 10);
  };

  async function propiedad(calle: string): Promise<string> {
    const r = await http().post('/v1/propiedades').set(...como(inmo))
      .send({ calle, localidad: 'Ciudad', tipo: 'casa' }).expect(201);
    return r.body.id;
  }

  async function contrato(propiedadId: string, desde: string, hasta: string): Promise<string> {
    const dueno = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Due', apellido: propiedadId.slice(0, 6) }).expect(201);
    const inq = await http().post('/v1/personas').set(...como(inmo))
      .send({ nombre: 'Inq', apellido: propiedadId.slice(0, 6) }).expect(201);

    const c = await http().post('/v1/contratos').set(...como(inmo))
      .send({
        propiedadId, fechaInicio: desde, fechaFin: hasta,
        montoInicial: 400000, moneda: 'ARS', indice: 'ninguno',
        mesBase: `${desde.slice(0, 7)}-01`, honorariosPct: 10,
        locadores: [{ personaId: dueno.body.id, porcentaje: 100 }],
        locatarios: [inq.body.id],
      })
      .expect(201);
    return c.body.id;
  }

  const estadoDe = async (contratoId: string) =>
    (await db.withTenant(inmo.tenantId, async (ej) => {
      const { rows } = await ej.query<{ estado: string }>(
        'SELECT estado FROM contrato_alquiler WHERE id = $1', [contratoId]);
      return rows;
    }))[0].estado;

  // ───────────────────────────────────────────────────────────────────────────
  // A · Archivar una propiedad
  // ───────────────────────────────────────────────────────────────────────────

  describe('archivar una propiedad', () => {
    it('la que nunca tuvo nada SÍ se puede borrar de verdad', async () => {
      const id = await propiedad('Virgen');
      await http().delete(`/v1/propiedades/${id}`).set(...como(inmo)).expect(204);
    });

    /**
     * El caso que motivó todo esto.
     *
     * Las claves foráneas ya lo impedían —son RESTRICT y está bien— pero el
     * freno llegaba como un 500 «Ocurrió un error inesperado». La regla era
     * correcta y la explicación no existía.
     */
    it('la que tiene historia NO se borra, y se dice qué hacer en su lugar', async () => {
      const id = await propiedad('Con Historia');
      await contrato(id, enAnios(-3), enAnios(-2));

      const r = await http().delete(`/v1/propiedades/${id}`).set(...como(inmo)).expect(409);
      expect(r.body.code).toBe('ESTADO_INVALIDO');
      expect(r.body.detail).toContain('contrato');
      expect(r.body.detail).toContain('Archivala');
    });

    it('archivar la saca del listado, y se la puede pedir aparte', async () => {
      const id = await propiedad('Se Archiva');
      await http().post(`/v1/propiedades/${id}/archivar`).set(...como(inmo))
        .send({ motivo: 'Se vendió' }).expect(201);

      const activas = await http().get('/v1/propiedades?q=Se Archiva&porPagina=50')
        .set(...como(inmo)).expect(200);
      expect(activas.body.items).toHaveLength(0);

      const archivadas = await http().get('/v1/propiedades?q=Se Archiva&archivadas=true')
        .set(...como(inmo)).expect(200);
      expect(archivadas.body.items).toHaveLength(1);
    });

    it('al archivar se cierran sus operaciones y sale de la Red', async () => {
      const id = await propiedad('Ofrecida');
      await http().post(`/v1/propiedades/${id}/operaciones`).set(...como(inmo))
        .send({ tipo: 'venta', precio: 150000, moneda: 'USD', estado: 'disponible' })
        .expect(201);
      await http().put(`/v1/red/propiedades/${id}`).set(...como(inmo))
        .send({ compartida: true, comisionPct: 2 }).expect(200);

      await http().post(`/v1/propiedades/${id}/archivar`).set(...como(inmo)).send({}).expect(201);

      // Archivada y «disponible» a la vez es una contradicción: seguiría
      // saliendo en el feed a los portales y en la Red.
      const r = await http().get(`/v1/propiedades/${id}`).set(...como(inmo)).expect(200);
      expect(r.body.operaciones.every((o: { estado: string }) => o.estado === 'cerrada')).toBe(true);
      expect(r.body.redCompartida).toBe(false);
    });

    it('no se puede archivar con un contrato en curso', async () => {
      // Sacar de la cartera algo que está alquilado HOY deja al inquilino, a
      // las cuotas y a la liquidación colgando de algo que ya no se muestra.
      const id = await propiedad('Alquilada Hoy');
      await contrato(id, enAnios(-1), enAnios(1));

      const r = await http().post(`/v1/propiedades/${id}/archivar`).set(...como(inmo))
        .send({}).expect(409);
      expect(r.body.detail).toContain('contrato en curso');
    });

    it('desarchivar la devuelve, pero NO reabre sus operaciones', async () => {
      const id = await propiedad('Vuelve');
      await http().post(`/v1/propiedades/${id}/operaciones`).set(...como(inmo))
        .send({ tipo: 'venta', precio: 100000, moneda: 'USD', estado: 'disponible' })
        .expect(201);
      await http().post(`/v1/propiedades/${id}/archivar`).set(...como(inmo)).send({}).expect(201);
      await http().post(`/v1/propiedades/${id}/desarchivar`).set(...como(inmo)).expect(201);

      const lista = await http().get('/v1/propiedades?q=Vuelve').set(...como(inmo)).expect(200);
      expect(lista.body.items).toHaveLength(1);

      // Cuál vuelve a estar disponible y a qué precio es una decisión.
      // Adivinarla podría publicar una propiedad al valor de hace dos años.
      const r = await http().get(`/v1/propiedades/${id}`).set(...como(inmo)).expect(200);
      expect(r.body.operaciones.every((o: { estado: string }) => o.estado === 'cerrada')).toBe(true);
    });

    it('un asesor no archiva: toca la cartera entera', async () => {
      const id = await propiedad('De Nadie');
      await http().post(`/v1/propiedades/${id}/archivar`).set(...como(inmo, 'agente'))
        .send({}).expect(403);
    });

    /**
     * Si las archivadas contaran para el tope, archivar no liberaría un solo
     * lugar y la única salida sería borrar — que es exactamente lo que las
     * claves foráneas impiden. La cuenta quedaría trabada sin acción posible.
     */
    it('una archivada no ocupa lugar en el tope del plan', async () => {
      const antes = await db.withTenant(inmo.tenantId, async (ej) => {
        const { rows } = await ej.query<{ usado: number }>(
          "SELECT usado FROM app_limite_plan('propiedades')");
        return rows[0].usado;
      });

      const id = await propiedad('Ocupa Lugar');
      await http().post(`/v1/propiedades/${id}/archivar`).set(...como(inmo)).send({}).expect(201);

      const despues = await db.withTenant(inmo.tenantId, async (ej) => {
        const { rows } = await ej.query<{ usado: number }>(
          "SELECT usado FROM app_limite_plan('propiedades')");
        return rows[0].usado;
      });

      expect(despues).toBe(antes);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B · Vencer contratos
  // ───────────────────────────────────────────────────────────────────────────

  describe('el vencimiento automático', () => {
    it('pasa a vencido lo que ya terminó', async () => {
      const id = await propiedad('Terminado');
      const c = await contrato(id, enAnios(-3), enAnios(-1));
      expect(await estadoDe(c)).toBe('vigente');

      await cron.correr();
      expect(await estadoDe(c)).toBe('vencido');
    });

    it('no toca el que sigue corriendo', async () => {
      const id = await propiedad('Corriendo');
      const c = await contrato(id, enAnios(-1), enAnios(1));
      await cron.correr();
      expect(await estadoDe(c)).toBe('vigente');
    });

    /**
     * El caso que separa un vencimiento de un borrado de deuda.
     *
     * Alguien que se fue debiendo tres meses los sigue debiendo. Si el
     * vencimiento cerrara las cuotas, la inmobiliaria perdería el reclamo — y
     * es plata de un propietario, no de la inmobiliaria.
     */
    it('NO toca una sola cuota: la deuda sobrevive al contrato', async () => {
      const id = await propiedad('Debiendo');
      const c = await contrato(id, enAnios(-3), enAnios(-1));

      await http().post(`/v1/contratos/${c}/periodos/generar`).set(...como(inmo))
        .send({ hasta: enAnios(-1) }).expect(201);

      const antes = await http().get(`/v1/contratos/${c}/periodos?porPagina=100`)
        .set(...como(inmo)).expect(200);
      const impagasAntes = antes.body.items.filter(
        (p: { estado: string }) => p.estado !== 'pagado').length;
      expect(impagasAntes).toBeGreaterThan(0);

      await cron.correr();

      const despues = await http().get(`/v1/contratos/${c}/periodos?porPagina=100`)
        .set(...como(inmo)).expect(200);
      const impagasDespues = despues.body.items.filter(
        (p: { estado: string }) => p.estado !== 'pagado').length;
      expect(impagasDespues).toBe(impagasAntes);
    });

    it('correrlo dos veces no cambia nada', async () => {
      const primera = await cron.correr();
      const segunda = await cron.correr();
      expect(segunda).toBe(0);
      expect(primera).toBeGreaterThanOrEqual(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C · Los roles caducan
  // ───────────────────────────────────────────────────────────────────────────

  describe('los roles caducan', () => {
    it('quien alquila HOY es inquilino; quien alquiló y se fue, ex inquilino', async () => {
      const idViejo = await propiedad('Rol Viejo');
      const cViejo = await contrato(idViejo, enAnios(-4), enAnios(-2));
      const idHoy = await propiedad('Rol Hoy');
      await contrato(idHoy, enAnios(-1), enAnios(1));

      await cron.correr();
      expect(await estadoDe(cViejo)).toBe('vencido');

      const r = await http().get('/v1/personas?porPagina=100').set(...como(inmo)).expect(200);
      const items = r.body.items as Array<{ apellido: string; roles: string[] }>;

      const viejo = items.find((p) => p.apellido === idViejo.slice(0, 6) && p.roles.length);
      const hoy = items.find((p) => p.apellido === idHoy.slice(0, 6) && p.roles.includes('inquilino'));

      expect(hoy?.roles).toContain('inquilino');
      expect(hoy?.roles).not.toContain('ex_inquilino');

      const exViejo = items.filter((p) => p.apellido === idViejo.slice(0, 6));
      expect(exViejo.some((p) => p.roles.includes('ex_inquilino'))).toBe(true);
      expect(exViejo.some((p) => p.roles.includes('inquilino'))).toBe(false);
      expect(viejo).toBeDefined();
    });

    it('el propietario NO caduca: la propiedad sigue siendo suya', async () => {
      const id = await propiedad('Del Dueño');
      const dueno = await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Dueña', apellido: 'Perpetua' }).expect(201);
      // Los titulares se ponen con un PATCH de la propiedad, no con una ruta
      // propia. La primera versión de este test inventó `PUT /titulares` y
      // toleraba el 404 — o sea que no probaba nada.
      await http().patch(`/v1/propiedades/${id}`).set(...como(inmo))
        .send({ titulares: [{ personaId: dueno.body.id, porcentaje: 100 }] })
        .expect(200);

      await http().post(`/v1/propiedades/${id}/archivar`).set(...como(inmo)).send({}).expect(201);

      const r = await http().get(`/v1/personas/${dueno.body.id}`).set(...como(inmo)).expect(200);
      // Aunque la propiedad esté archivada, sigue siendo su dueña.
      expect(r.body.roles).toContain('propietario');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // D · El semáforo
  // ───────────────────────────────────────────────────────────────────────────

  describe('el semáforo', () => {
    let persona = '';

    beforeAll(async () => {
      const r = await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Marcada', apellido: 'Semaforo' }).expect(201);
      persona = r.body.id;
    });

    it('arranca sin marcar', async () => {
      const r = await http().get(`/v1/personas/${persona}`).set(...como(inmo)).expect(200);
      expect(r.body.semaforo.estado).toBe('sin_marcar');
      expect(r.body.semaforo.motivo).toBeNull();
    });

    it('marcar guarda el motivo, quién y cuándo', async () => {
      const r = await http().patch(`/v1/personas/${persona}/semaforo`).set(...como(inmo))
        .send({ estado: 'no_alquilar', motivo: 'Se fue debiendo cuatro meses y no atendió.' })
        .expect(200);

      expect(r.body.semaforo.estado).toBe('no_alquilar');
      expect(r.body.semaforo.motivo).toContain('cuatro meses');
      // El NOMBRE de quien marcó, no su id: es para leer.
      expect(r.body.semaforo.por).toBeTruthy();
      expect(r.body.semaforo.el).toBeTruthy();
    });

    /**
     * Una marca sin motivo es un rumor con forma de dato: dentro de seis meses
     * nadie sabe por qué está puesta, y quien la lee no puede evaluarla.
     */
    it('no se puede marcar sin decir por qué', async () => {
      const r = await http().patch(`/v1/personas/${persona}/semaforo`).set(...como(inmo))
        .send({ estado: 'con_reparos' })
        .expect(400);
      expect(r.body.detail).toContain('por qué');
    });

    it('desmarcar limpia el motivo, no lo deja colgando', async () => {
      await http().patch(`/v1/personas/${persona}/semaforo`).set(...como(inmo))
        .send({ estado: 'sin_marcar' }).expect(200);

      const r = await http().get(`/v1/personas/${persona}`).set(...como(inmo)).expect(200);
      expect(r.body.semaforo.motivo).toBeNull();
      expect(r.body.semaforo.por).toBeNull();
    });

    it('un asesor no marca a nadie', async () => {
      await http().patch(`/v1/personas/${persona}/semaforo`).set(...como(inmo, 'agente'))
        .send({ estado: 'no_alquilar', motivo: 'x' }).expect(403);
    });

    /**
     * AVISA, NUNCA BLOQUEA.
     *
     * Que el software se niegue a dejarte alquilarle a alguien es una decisión
     * que no le corresponde. Además, una marca puesta con bronca dejaría a una
     * persona afuera en silencio y para siempre.
     */
    it('marcado «no alquilar» se le puede armar un contrato igual', async () => {
      await http().patch(`/v1/personas/${persona}/semaforo`).set(...como(inmo))
        .send({ estado: 'no_alquilar', motivo: 'Debió cuatro meses.' }).expect(200);

      const id = await propiedad('Igual Se Alquila');
      const dueno = await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: 'Otro', apellido: 'Dueño' }).expect(201);

      await http().post('/v1/contratos').set(...como(inmo))
        .send({
          propiedadId: id, fechaInicio: enAnios(0), fechaFin: enAnios(2),
          montoInicial: 400000, moneda: 'ARS', indice: 'ninguno',
          mesBase: `${enAnios(0).slice(0, 7)}-01`, honorariosPct: 10,
          locadores: [{ personaId: dueno.body.id, porcentaje: 100 }],
          locatarios: [persona],
        })
        .expect(201);
    });
  });
});
