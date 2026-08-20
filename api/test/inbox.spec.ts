import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * El inbox omnicanal, de punta a punta (etapa 18).
 *
 * Entra un mensaje por el webhook, se arma el hilo, decide el bot, escala si
 * hace falta y el agente contesta. Es el ciclo entero contra Postgres real.
 *
 * ── La cuenta de prueba no tiene token de bot, y es a propósito ──
 *
 * Con `webhookSecret` configurado pero SIN token, la entrada funciona completa
 * y la salida no puede salir. Eso evita llamadas de red en los tests y además
 * prueba la regla que manda sobre esta feature: **lo que no salió queda como
 * pendiente y se dice**, nunca se simula que salió.
 */
describe('Inbox omnicanal', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let vecina: Inmobiliaria;
  let cuentaId = '';
  let webhook = '';

  const SECRETO = 'secreto-del-webhook-de-prueba';
  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  /** Simula a Telegram pegándole al webhook. */
  const entra = (texto: string, chatId = '900001', nombre = 'Ana Cliente', msgId = 0) =>
    http()
      .post(webhook)
      .set('x-telegram-bot-api-secret-token', SECRETO)
      .send({
        message: {
          message_id: msgId || Math.floor(Math.random() * 1e6),
          date: Math.floor(Date.now() / 1000),
          text: texto,
          chat: { id: chatId },
          from: { first_name: nombre },
        },
      });

  const bandeja = (q = '', i = inmo, rol: 'owner' | 'agente' = 'owner') =>
    http().get(`/v1/inbox${q}`).set(...como(i, rol));

  /** El secreto no sale por la API a propósito: para el test se lee de la base. */
  async function secretoDe(cuentaId: string): Promise<string> {
    const { Client } = await import('pg');
    const { loadEnv } = await import('../src/config/env');
    const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await c.connect();
    try {
      const { rows } = await c.query<{ s: string }>(
        "SELECT config->>'webhookSecret' AS s FROM canal_cuenta WHERE id = $1",
        [cuentaId],
      );
      return rows[0].s;
    } finally {
      await c.end();
    }
  }

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('inbox', tk);
    vecina = await crearInmobiliaria('inboxvecina', tk);

    const cuenta = await http().post('/v1/canales').set(...como(inmo))
      .send({
        canal: 'telegram', proveedor: 'telegram',
        nombre: 'Ventas', identificador: '@bemo_test_bot',
        config: { webhookSecret: SECRETO },
      })
      .expect(201);

    cuentaId = cuenta.body.id;
    webhook = cuenta.body.rutaWebhook;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  describe('la cuenta de canal', () => {
    it('se crea con su ruta de webhook impredecible', () => {
      expect(webhook).toMatch(/^\/v1\/webhooks\/[A-Za-z0-9_-]{20,}$/);
    });

    it('NUNCA devuelve el secreto, ni al titular', async () => {
      // Un token que la pantalla puede mostrar es un token que termina en una
      // captura o en el historial del navegador.
      const r = await http().get('/v1/canales').set(...como(inmo)).expect(200);
      const texto = JSON.stringify(r.body);
      expect(texto).not.toContain(SECRETO);
      expect(r.body[0].tieneSecreto).toBe(false);
    });

    it('el secreto del webhook se genera SOLO y tampoco sale', async () => {
      // En Telegram lo elegimos nosotros y se lo pasamos a `setWebhook`:
      // pedírselo al usuario es pedirle que invente una credencial nuestra. Y
      // sin él `verificarFirma` rechaza todo, así que el canal quedaría
      // conectado pero sordo —parece que anda y no entra un mensaje—.
      const propia = await http().post('/v1/canales').set(...como(inmo))
        .send({
          canal: 'telegram', proveedor: 'telegram',
          nombre: 'Auto', identificador: '@auto_bot',
        })
        .expect(201);

      expect(propia.body.config.webhookSecret).toBeUndefined();

      // Y anda: un webhook firmado con ese secreto entra.
      const secreto = await secretoDe(propia.body.id);
      expect(secreto).toMatch(/^[A-Za-z0-9_-]{20,}$/);

      await http().post(propia.body.rutaWebhook)
        .set('x-telegram-bot-api-secret-token', secreto)
        .send({
          message: {
            message_id: 4242, text: 'probando el secreto automático',
            chat: { id: '777777' }, from: { first_name: 'Auto' },
          },
        })
        .expect(200);

      const r = await http().get('/v1/inbox?q=Auto').set(...como(inmo)).expect(200);
      expect(r.body.items.length).toBe(1);
    });

    it('dice que NO está disponible y por qué', async () => {
      const r = await http().get('/v1/canales').set(...como(inmo)).expect(200);
      expect(r.body[0].disponible).toBe(false);
      expect(r.body[0].detalle).toContain('BotFather');
    });

    it('el asesor no puede conectar canales', async () => {
      await http().get('/v1/canales').set(...como(inmo, 'agente')).expect(403);
    });

    it('rechaza un par canal/proveedor imposible', async () => {
      await http().post('/v1/canales').set(...como(inmo))
        .send({
          canal: 'instagram', proveedor: 'telegram',
          nombre: 'Imposible', identificador: '@algo',
        })
        .expect(422);
    });
  });

  describe('cuando entra un mensaje', () => {
    it('arma el hilo y lo deja en la bandeja', async () => {
      await entra('hola, busco depto para alquilar', '900001').expect(200);

      const r = await bandeja().expect(200);
      expect(r.body.total).toBeGreaterThan(0);

      const c = r.body.items.find((x: { contacto: string }) => x.contacto === 'Ana Cliente');
      expect(c).toBeDefined();
      expect(c.canal).toBe('telegram');
      expect(c.noLeido).toBe(true);
      expect(c.ultimoMensaje).toContain('alquilar');
    });

    it('el mismo mensaje dos veces es UN mensaje', async () => {
      // Los proveedores reintentan. Un mensaje repetido en un hilo se lee como
      // que el cliente insistió, y eso es peor que uno que falta.
      await entra('mensaje repetido', '900002', 'Repetido', 555).expect(200);
      await entra('mensaje repetido', '900002', 'Repetido', 555).expect(200);

      const lista = await bandeja('?q=Repetido').expect(200);
      const hilo = await http().get(`/v1/inbox/${lista.body.items[0].id}`)
        .set(...como(inmo)).expect(200);

      const delCliente = hilo.body.mensajes.filter(
        (m: { direccion: string }) => m.direccion === 'entrante',
      );
      expect(delCliente).toHaveLength(1);
    });

    it('una firma inválida NO hace nada — y contesta 200 igual', async () => {
      // 200 porque los proveedores reintentan ante cualquier cosa que no sea
      // 2xx, y reintentar algo que rechazamos a propósito no lo arregla.
      const antes = (await bandeja().expect(200)).body.total;

      await http().post(webhook)
        .set('x-telegram-bot-api-secret-token', 'secreto-equivocado')
        .send({ message: { message_id: 1, text: 'inyectado', chat: { id: '666' } } })
        .expect(200);

      expect((await bandeja().expect(200)).body.total).toBe(antes);
    });

    it('sin firma tampoco', async () => {
      const antes = (await bandeja().expect(200)).body.total;
      await http().post(webhook)
        .send({ message: { message_id: 2, text: 'sin firma', chat: { id: '667' } } })
        .expect(200);
      expect((await bandeja().expect(200)).body.total).toBe(antes);
    });

    it('un token de webhook inventado no filtra que existan los otros', async () => {
      await http().post('/v1/webhooks/token-que-no-existe')
        .send({ message: { message_id: 3, text: 'x', chat: { id: '668' } } })
        .expect(200);
    });
  });

  describe('el bot', () => {
    it('escala cuando el cliente pide una persona, y AVISA', async () => {
      await entra('quiero hablar con un asesor', '900010', 'Pide Humano').expect(200);

      const avisos = await http().get('/v1/avisos?tipo=conversacion_escalada')
        .set(...como(inmo)).expect(200);

      const a = avisos.body.items.find((x: { titulo: string }) =>
        x.titulo.includes('Pide Humano'));
      expect(a).toBeDefined();
      expect(a.detalle).toContain('pidió hablar con una persona');
    });

    it('lo que contesta el bot queda en el hilo como pendiente, no como enviado', async () => {
      // La cuenta no tiene token, así que no puede salir. El sistema lo dice en
      // vez de simular que salió.
      const lista = await bandeja('?q=Pide Humano').expect(200);
      const hilo = await http().get(`/v1/inbox/${lista.body.items[0].id}`)
        .set(...como(inmo)).expect(200);

      const delBot = hilo.body.mensajes.find((m: { autorTipo: string }) => m.autorTipo === 'bot');
      expect(delBot).toBeDefined();
      expect(delBot.estado).toBe('pendiente');
      expect(delBot.error).toContain('token');
    });

    it('avisa también cuando el cliente CONFIRMA', async () => {
      await entra('dale, confirmo la visita', '900011', 'Confirma').expect(200);

      const avisos = await http().get('/v1/avisos?tipo=conversacion_escalada')
        .set(...como(inmo)).expect(200);
      const a = avisos.body.items.find((x: { titulo: string }) => x.titulo.includes('Confirma'));
      expect(a).toBeDefined();
      expect(a.detalle).toContain('confirmó');
    });
  });

  describe('atender', () => {
    let hiloId = '';

    beforeAll(async () => {
      await entra('necesito ayuda con el contrato', '900020', 'Para Atender').expect(200);
      const lista = await bandeja('?q=Para Atender').expect(200);
      hiloId = lista.body.items[0].id;
    });

    it('abrir el hilo lo marca leído', async () => {
      await http().get(`/v1/inbox/${hiloId}`).set(...como(inmo)).expect(200);
      const lista = await bandeja('?q=Para Atender').expect(200);
      expect(lista.body.items[0].noLeido).toBe(false);
    });

    it('contestar dice si salió o quedó en cola', async () => {
      const r = await http().post(`/v1/inbox/${hiloId}/mensajes`).set(...como(inmo))
        .send({ texto: 'Hola, te ayudo con eso.' }).expect(201);

      expect(r.body.enviado).toBe(false);
      expect(r.body.detalle).toContain('token');
    });

    it('y la respuesta del agente PAUSA al bot', async () => {
      // Es la idea que vino del demo de WhatChimp: el bot no se mete cuando hay
      // una persona atendiendo, y se reactiva solo. No depende de que el agente
      // se acuerde de apagarlo.
      await entra('otra consulta más', '900020', 'Para Atender').expect(200);

      const hilo = await http().get(`/v1/inbox/${hiloId}`).set(...como(inmo)).expect(200);
      const bots = hilo.body.mensajes.filter((m: { autorTipo: string }) => m.autorTipo === 'bot');
      // El bot contestó al PRIMER mensaje, no al de después de que habló el agente.
      expect(bots.length).toBeLessThanOrEqual(1);
    });

    it('se puede asignar, resolver y reabrir', async () => {
      await http().patch(`/v1/inbox/${hiloId}/asignado`).set(...como(inmo))
        .send({ usuarioId: inmo.usuarios.agente }).expect(200);

      await http().patch(`/v1/inbox/${hiloId}/estado`).set(...como(inmo))
        .send({ estado: 'resuelta' }).expect(200);

      // Resuelto sale de la bandeja abierta.
      const abierta = await bandeja('?q=Para Atender').expect(200);
      expect(abierta.body.items).toHaveLength(0);

      // Pero si el cliente vuelve a escribir, VUELVE. Si no, escribe y nadie se
      // entera nunca: quedó archivado del lado nuestro.
      await entra('hola? sigo esperando', '900020', 'Para Atender').expect(200);
      const devuelta = await bandeja('?q=Para Atender').expect(200);
      expect(devuelta.body.items).toHaveLength(1);
    });

    it('un hilo BLOQUEADO descarta lo que entra', async () => {
      await entra('spam spam spam', '900030', 'Spammer').expect(200);
      const lista = await bandeja('?q=Spammer').expect(200);
      const id = lista.body.items[0].id;

      await http().patch(`/v1/inbox/${id}/estado`).set(...como(inmo))
        .send({ estado: 'bloqueada' }).expect(200);

      const antes = (await http().get(`/v1/inbox/${id}`).set(...como(inmo)).expect(200))
        .body.mensajes.length;

      await entra('más spam', '900030', 'Spammer').expect(200);

      const despues = (await http().get(`/v1/inbox/${id}`).set(...como(inmo)).expect(200))
        .body.mensajes.length;
      expect(despues).toBe(antes);
    });
  });

  describe('privacidad y aislamiento', () => {
    it('al asesor el identificador le sale enmascarado', async () => {
      // Misma decisión que la 17.2: el dato personal se muestra a quien lo
      // necesita para trabajar, y atender un chat no lo necesita.
      const comoOwner = await bandeja('?q=Ana Cliente', inmo, 'owner').expect(200);
      const comoAgente = await bandeja('?q=Ana Cliente', inmo, 'agente').expect(200);

      expect(comoOwner.body.items[0].direccion).toBe('900001');
      expect(comoAgente.body.items[0].direccion).toContain('····');
    });

    it('cero fuga: la vecina no ve nada', async () => {
      const r = await bandeja('', vecina).expect(200);
      expect(r.body.items).toEqual([]);
    });

    it('la vecina tampoco puede abrir un hilo ajeno', async () => {
      const mios = await bandeja('', inmo).expect(200);
      await http().get(`/v1/inbox/${mios.body.items[0].id}`)
        .set(...como(vecina)).expect(404);
    });
  });
});
