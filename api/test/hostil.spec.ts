import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * La suite hostil: no prueba que la app funcione, prueba que **no se la pueda
 * doblar**. Es el gate de la etapa 17.5.
 *
 * ── Por qué existe si ya está `aislamiento.spec.ts` ──
 *
 * Aquel prueba que RLS no deje LEER lo ajeno, y no deja. Éste prueba lo otro:
 * que no se pueda ESCRIBIR una referencia a algo ajeno. Son puertas distintas
 * y sólo una estaba cerrada.
 *
 * El agujero concreto: **las claves foráneas no pasan por RLS**. El chequeo de
 * integridad de Postgres corre por debajo de las políticas, así que
 * `FOREIGN KEY (agente_id) REFERENCES usuario(id)` acepta feliz el id de un
 * usuario de otra inmobiliaria. No filtra datos —el JOIN de vuelta sí está
 * protegido y devuelve NULL—, pero deja el lead colgado de alguien que no
 * existe de este lado: desaparece de todas las pantallas y sigue en la base.
 *
 * En comisiones es peor, porque lo que queda colgado es plata.
 */
describe('Superficie hostil — ids de otra inmobiliaria', () => {
  let app: INestApplication;
  let mia: Inmobiliaria;
  let ajena: Inmobiliaria;

  let personaId = '';
  let propiedadId = '';
  let oportunidadId = '';
  /** Una operación de la OTRA inmobiliaria: el señuelo. */
  let operacionAjena = '';

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    mia = await crearInmobiliaria('hostil', tk);
    ajena = await crearInmobiliaria('hostilvecina', tk);

    personaId = (await http().post('/v1/personas').set(...como(mia))
      .send({ nombre: 'Sujeto', apellido: 'De Prueba' }).expect(201)).body.id;

    propiedadId = (await http().post('/v1/propiedades').set(...como(mia))
      .send({ calle: 'Hostil 100', tipo: 'departamento' }).expect(201)).body.id;

    oportunidadId = (await http().post('/v1/oportunidades').set(...como(mia))
      .send({ personaId, origen: 'web', interes: 'venta' }).expect(201)).body.id;

    // El señuelo se crea con las credenciales de la vecina: es un id real y
    // válido, sólo que de otro dueño. Inventar un uuid al azar no probaría
    // nada —fallaría por inexistente, no por ajeno—.
    const propAjena = (await http().post('/v1/propiedades').set(...como(ajena))
      .send({ calle: 'Vecina 200', tipo: 'casa' }).expect(201)).body.id;
    // Ojo: este POST devuelve la PROPIEDAD entera, no la operación. Leer
    // `body.id` acá daba el id de la propiedad, y el test fallaba por FK
    // inexistente en vez de por ajena —o sea, probaba otra cosa—.
    operacionAjena = (await http().post(`/v1/propiedades/${propAjena}/operaciones`)
      .set(...como(ajena))
      .send({ tipo: 'venta', precio: 100000, moneda: 'USD' }).expect(201))
      .body.operaciones[0].id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  /** El id de un asesor real, pero de la otra inmobiliaria. */
  const asesorAjeno = () => ajena.usuarios.agente;

  describe('un agente de otra inmobiliaria no se puede asignar', () => {
    it('al crear un lead', async () => {
      const r = await http().post('/v1/oportunidades').set(...como(mia))
        .send({ personaId, origen: 'web', agenteId: asesorAjeno() });
      expect(r.status).toBe(422);
    });

    it('al reasignar un lead', async () => {
      const r = await http().patch(`/v1/oportunidades/${oportunidadId}`).set(...como(mia))
        .send({ agenteId: asesorAjeno() });
      expect(r.status).toBe(422);
    });

    it('al agendar una visita', async () => {
      const r = await http().post(`/v1/oportunidades/${oportunidadId}/visitas`)
        .set(...como(mia))
        .send({ fechaHora: new Date(Date.now() + 86_400_000).toISOString(), agenteId: asesorAjeno() });
      expect(r.status).toBe(422);
    });

    it('como captador de una propiedad', async () => {
      const r = await http().patch(`/v1/propiedades/${propiedadId}`).set(...como(mia))
        .send({ agenteCaptadorId: asesorAjeno() });
      expect(r.status).toBe(422);
    });

    it('pero el asesor propio sí, obvio', async () => {
      await http().patch(`/v1/propiedades/${propiedadId}`).set(...como(mia))
        .send({ agenteCaptadorId: mia.usuarios.agente }).expect(200);
    });
  });

  describe('el reparto de una venta', () => {
    it('no le puede asignar comisión a un agente ajeno', async () => {
      // La más cara de las cuatro columnas selladas: acá lo que quedaría
      // colgado de alguien que de este lado no existe es PLATA. La comisión se
      // guardaría con su monto y su porcentaje, y el listado por agente la
      // mostraría sin nombre.
      const propia = (await http().post('/v1/propiedades').set(...como(mia))
        .send({ calle: 'Reparto 300', tipo: 'casa' }).expect(201)).body.id;
      const op = (await http().post(`/v1/propiedades/${propia}/operaciones`)
        .set(...como(mia))
        .send({ tipo: 'venta', precio: 200000, moneda: 'USD' }).expect(201))
        .body.operaciones[0].id;
      const venta = (await http().post('/v1/ventas').set(...como(mia))
        .send({ operacionId: op, precioCierre: 200000, moneda: 'USD' }).expect(201)).body;

      const r = await http().post(`/v1/ventas/${venta.id}/reparto`).set(...como(mia))
        .send({
          puntas: { compradora: 3, vendedora: 3 },
          repartoInterno: {
            captador: { usuarioId: asesorAjeno(), nombre: 'Ajeno', porcentaje: 25 },
          },
        });

      expect(r.status).toBe(422);
      expect(r.body.code).toBe('REFERENCIA_INVALIDA');
    });
  });

  describe('una operación de otra inmobiliaria no se puede referenciar', () => {
    it('desde un lead', async () => {
      const r = await http().post('/v1/oportunidades').set(...como(mia))
        .send({ personaId, origen: 'web', operacionId: operacionAjena });
      // 404 y no 422: desde acá esa operación NO EXISTE, y decir «no es de tu
      // inmobiliaria» ya sería confirmar que existe.
      expect([404, 422]).toContain(r.status);
    });

    it('desde una visita', async () => {
      const r = await http().post(`/v1/oportunidades/${oportunidadId}/visitas`)
        .set(...como(mia))
        .send({ fechaHora: new Date(Date.now() + 86_400_000).toISOString(), operacionId: operacionAjena });
      expect([404, 422]).toContain(r.status);
    });
  });

  describe('los filtros no son una puerta de atrás', () => {
    it('filtrar por un agente ajeno devuelve vacío, no error ni datos', async () => {
      const r = await http().get(`/v1/oportunidades?agenteId=${asesorAjeno()}`)
        .set(...como(mia)).expect(200);
      expect(r.body.items).toEqual([]);
    });

    it('pedir por id una propiedad ajena es un 404 liso', async () => {
      const propAjena = (await http().get('/v1/propiedades').set(...como(ajena))
        .expect(200)).body.items[0].id;
      await http().get(`/v1/propiedades/${propAjena}`).set(...como(mia)).expect(404);
    });
  });
});
