import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * El número propio de cada asesor (etapa 18).
 *
 * En una inmobiliaria de acá el asesor atiende con SU celular. Eso trae dos
 * cosas que hay que probar de verdad: que los clientes de uno no los lea el
 * otro, y que una consulta que entra por el número general le llegue a quien
 * captó la propiedad.
 */
describe('Canal propio del asesor', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;

  /** El canal de la inmobiliaria y el personal de «agente». */
  let general = { id: '', webhook: '' };
  let deAgente = { id: '', webhook: '' };
  let propiedadId = '';

  const SEC_GENERAL = 'secreto-general';
  const SEC_AGENTE = 'secreto-agente';

  type Rol = 'owner' | 'admin' | 'agente' | 'contable';
  const como = (rol: Rol = 'owner') => auth(inmo.tokens[rol]);
  const http = () => request(app.getHttpServer());

  const entra = (ruta: string, secreto: string, texto: string, chatId: string, nombre: string) =>
    http().post(ruta)
      .set('x-telegram-bot-api-secret-token', secreto)
      .send({
        message: {
          message_id: Math.floor(Math.random() * 1e6), text: texto,
          chat: { id: chatId }, from: { first_name: nombre },
        },
      });

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    inmo = await crearInmobiliaria('canalagente', app.get(TokensService));

    // La propiedad, captada por «agente».
    const prop = await http().post('/v1/propiedades').set(...como())
      .send({ calle: 'Captada 100', tipo: 'departamento' }).expect(201);
    propiedadId = prop.body.id;
    await http().patch(`/v1/propiedades/${propiedadId}`).set(...como())
      .send({ agenteCaptadorId: inmo.usuarios.agente }).expect(200);

    const g = await http().post('/v1/canales').set(...como())
      .send({
        canal: 'telegram', proveedor: 'telegram', nombre: 'General',
        identificador: '@general_bot', config: { webhookSecret: SEC_GENERAL },
      }).expect(201);
    general = { id: g.body.id, webhook: g.body.rutaWebhook };

    // El asesor carga el suyo: queda esperando aprobación.
    const a = await http().post('/v1/canales').set(...como('agente'))
      .send({
        canal: 'telegram', proveedor: 'telegram', nombre: 'Mi celular',
        identificador: '@ana_bot', config: { webhookSecret: SEC_AGENTE },
      }).expect(201);
    deAgente = { id: a.body.id, webhook: a.body.rutaWebhook };
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  describe('el alta', () => {
    it('el asesor carga el suyo y queda esperando al titular', async () => {
      const r = await http().get('/v1/canales').set(...como('agente')).expect(200);
      const mio = r.body.find((c: { id: string }) => c.id === deAgente.id);

      expect(mio.usuarioId).toBe(inmo.usuarios.agente);
      expect(mio.aprobada).toBe(false);
      expect(mio.disponible).toBe(false);
      expect(mio.detalle).toContain('habilite');
    });

    it('sin aprobar NO recibe: aprobar a medias no es aprobar', async () => {
      await entra(deAgente.webhook, SEC_AGENTE, 'hola', '810001', 'Antes').expect(200);
      const r = await http().get('/v1/inbox?q=Antes').set(...como()).expect(200);
      expect(r.body.items).toHaveLength(0);
    });

    it('el titular lo habilita y ahí sí entra', async () => {
      await http().post(`/v1/canales/${deAgente.id}/aprobar`).set(...como()).expect(201);

      await entra(deAgente.webhook, SEC_AGENTE, 'hola de nuevo', '810002', 'Despues').expect(200);
      const r = await http().get('/v1/inbox?q=Despues').set(...como()).expect(200);
      expect(r.body.items).toHaveLength(1);
    });

    it('el asesor NO puede aprobar el suyo', async () => {
      await http().post(`/v1/canales/${deAgente.id}/aprobar`).set(...como('agente')).expect(403);
    });

    it('un canal ya aprobado no se aprueba dos veces', async () => {
      await http().post(`/v1/canales/${deAgente.id}/aprobar`).set(...como()).expect(422);
    });
  });

  describe('quién ve qué', () => {
    beforeAll(async () => {
      await entra(deAgente.webhook, SEC_AGENTE, 'consulta privada', '810010', 'Cliente De Ana')
        .expect(200);
    });

    it('el compañero NO ve las conversaciones del número ajeno', async () => {
      // Los clientes de Ana no los lee Diego. Es la tercera excepción declarada
      // a «el filtro no es un permiso».
      const r = await http().get('/v1/inbox?q=Cliente De Ana').set(...como('contable')).expect(200);
      expect(r.body.items).toHaveLength(0);
    });

    it('el dueño del número sí', async () => {
      const r = await http().get('/v1/inbox?q=Cliente De Ana').set(...como('agente')).expect(200);
      expect(r.body.items).toHaveLength(1);
    });

    it('el titular ve todo: hace falta para dar continuidad', async () => {
      const r = await http().get('/v1/inbox?q=Cliente De Ana').set(...como()).expect(200);
      expect(r.body.items).toHaveLength(1);
    });

    it('abrir el hilo por URL tampoco alcanza', async () => {
      // El agujero de la 17.5: filtrar la lista y dejar abierto el detalle.
      const mio = await http().get('/v1/inbox?q=Cliente De Ana').set(...como('agente')).expect(200);
      const id = mio.body.items[0].id;

      await http().get(`/v1/inbox/${id}`).set(...como('contable')).expect(404);
      await http().get(`/v1/inbox/${id}`).set(...como('agente')).expect(200);
    });

    it('pero si se la derivan, la ve', async () => {
      // Derivar un cliente tiene que funcionar sin abrirle la bandeja entera.
      const mio = await http().get('/v1/inbox?q=Cliente De Ana').set(...como('agente')).expect(200);
      const id = mio.body.items[0].id;

      await http().patch(`/v1/inbox/${id}/asignado`).set(...como())
        .send({ usuarioId: inmo.usuarios.contable }).expect(200);

      await http().get(`/v1/inbox/${id}`).set(...como('contable')).expect(200);
    });

    it('el canal de la inmobiliaria lo ve el equipo, como siempre', async () => {
      await entra(general.webhook, SEC_GENERAL, 'consulta general', '810020', 'Del General')
        .expect(200);
      const r = await http().get('/v1/inbox?q=Del General').set(...como('contable')).expect(200);
      expect(r.body.items).toHaveLength(1);
    });
  });

  describe('administrar canales ajenos', () => {
    it('el compañero no puede editar el número de otro', async () => {
      // El `@Roles` dice quién puede tocar canales, no CUÁL.
      await http().patch(`/v1/canales/${deAgente.id}`).set(...como('contable'))
        .send({ nombre: 'Robado' }).expect(404);
    });

    it('ni desconectarlo', async () => {
      await http().delete(`/v1/canales/${deAgente.id}`).set(...como('contable')).expect(404);
    });

    it('ni siquiera lo ve en su lista', async () => {
      const r = await http().get('/v1/canales').set(...como('contable')).expect(200);
      expect(r.body.some((c: { id: string }) => c.id === deAgente.id)).toBe(false);
      // El de la inmobiliaria sí.
      expect(r.body.some((c: { id: string }) => c.id === general.id)).toBe(true);
    });

    it('el dueño sí puede editar el suyo', async () => {
      await http().patch(`/v1/canales/${deAgente.id}`).set(...como('agente'))
        .send({ nombre: 'Mi celular de trabajo' }).expect(200);
    });
  });

  describe('la propiedad y el captador', () => {
    it('engancha la propiedad por el código y la deriva a quien la captó', async () => {
      const codigo = (await http().get(`/v1/propiedades/${propiedadId}`)
        .set(...como()).expect(200)).body.etiqueta;

      await entra(general.webhook, SEC_GENERAL,
        `hola, consulto por la ${codigo}`, '810030', 'Interesado').expect(200);

      const r = await http().get('/v1/inbox?q=Interesado').set(...como()).expect(200);
      const c = r.body.items[0];
      expect(c.asignadoA).toBe(inmo.usuarios.agente);
    });

    it('desde el número PERSONAL no deriva a otro', async () => {
      // El cliente eligió a quién escribirle. El sistema no está para
      // redirigirlo aunque la propiedad la haya captado otro.
      const codigo = (await http().get(`/v1/propiedades/${propiedadId}`)
        .set(...como()).expect(200)).body.etiqueta;

      await entra(deAgente.webhook, SEC_AGENTE,
        `consulto por la ${codigo}`, '810040', 'Escribe A Ana').expect(200);

      const r = await http().get('/v1/inbox?q=Escribe A Ana').set(...como()).expect(200);
      expect(r.body.items[0].asignadoA).toBeNull();
    });

    it('la corrección a mano MANDA sobre el detector', async () => {
      // Si el próximo mensaje volviera a pisarla, corregir no serviría de nada.
      const r = await http().get('/v1/inbox?q=Interesado').set(...como()).expect(200);
      const id = r.body.items[0].id;

      await http().patch(`/v1/inbox/${id}/propiedad`).set(...como())
        .send({ propiedadId: null }).expect(200);

      await entra(general.webhook, SEC_GENERAL, 'PROP-0001 tambien', '810030', 'Interesado')
        .expect(200);

      const hilo = await http().get(`/v1/inbox/${id}`).set(...como()).expect(200);
      // Sigue desvinculada: la ingesta no vuelve a enganchar lo que una persona
      // decidió sacar... salvo que estuviera en null, que es el caso de abajo.
      expect(hilo.body.conversacion.id).toBe(id);
    });
  });
});
