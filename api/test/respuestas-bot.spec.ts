import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * Respuestas rápidas y configuración del bot (etapa 18).
 */
describe('Respuestas rápidas y bot', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let vecina: Inmobiliaria;
  let cuentaId = '';
  let webhook = '';
  const SECRETO = 'secreto-respuestas';

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tk = app.get(TokensService);
    inmo = await crearInmobiliaria('respuestas', tk);
    vecina = await crearInmobiliaria('respuestasvecina', tk);

    const c = await http().post('/v1/canales').set(...como(inmo))
      .send({
        canal: 'telegram', proveedor: 'telegram',
        nombre: 'Ventas', identificador: '@resp_bot',
        config: { webhookSecret: SECRETO },
      })
      .expect(201);
    cuentaId = c.body.id;
    webhook = c.body.rutaWebhook;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  describe('respuestas rápidas', () => {
    let respuestaId = '';

    it('el asesor NO puede crearlas', async () => {
      // Una plantilla mal escrita se manda a cien clientes antes de que alguien
      // la lea.
      await http().post('/v1/respuestas').set(...como(inmo, 'agente'))
        .send({ nombre: 'X', cuerpo: 'y' }).expect(403);
    });

    it('se crea y trae su vista previa con valores de ejemplo', async () => {
      const r = await http().post('/v1/respuestas').set(...como(inmo))
        .send({
          nombre: 'Saludo inicial',
          cuerpo: 'Hola {nombre}, soy {agente} de {inmobiliaria}. ¿En qué te ayudo?',
        })
        .expect(201);

      respuestaId = r.body.id;
      // La vista previa NO usa datos de un cliente real: quien edita una
      // plantilla no tiene una conversación abierta.
      expect(r.body.vistaPrevia).toContain('Lucía');
      expect(r.body.vistaPrevia).not.toContain('{nombre}');
      expect(r.body.desconocidas).toEqual([]);
    });

    it('avisa si la plantilla tiene una variable que no existe', async () => {
      const r = await http().post('/v1/respuestas').set(...como(inmo))
        .send({ nombre: 'Con typo', cuerpo: 'Tu {propiedad} está lista.' })
        .expect(201);
      expect(r.body.desconocidas).toEqual(['propiedad']);
    });

    it('dos con el mismo nombre no se pueden', async () => {
      await http().post('/v1/respuestas').set(...como(inmo))
        .send({ nombre: 'Saludo inicial', cuerpo: 'otra' }).expect(409);
    });

    it('el asesor SÍ puede listarlas y usarlas: es su trabajo', async () => {
      const r = await http().get('/v1/respuestas').set(...como(inmo, 'agente')).expect(200);
      expect(r.body.length).toBeGreaterThan(0);
    });

    describe('al aplicarla a una conversación', () => {
      let conversacionId = '';

      beforeAll(async () => {
        await http().post(webhook)
          .set('x-telegram-bot-api-secret-token', SECRETO)
          .send({
            message: {
              message_id: 7001, text: 'hola', chat: { id: '710001' },
              from: { first_name: 'Lucía', last_name: 'Bravo' },
            },
          })
          .expect(200);

        const lista = await http().get('/v1/inbox?q=Lucía').set(...como(inmo)).expect(200);
        conversacionId = lista.body.items[0].id;
      });

      it('resuelve las variables con los datos REALES del hilo', async () => {
        const r = await http().post(`/v1/respuestas/${respuestaId}/aplicar`)
          .set(...como(inmo)).send({ conversacionId }).expect(201);

        expect(r.body.texto).toContain('Lucía Bravo');
        expect(r.body.texto).toContain('TEST_respuestas');
        expect(r.body.faltantes).toEqual([]);
      });

      it('NO la envía: sólo devuelve el texto', async () => {
        // La plantilla cae en el cuadro de respuesta y el asesor la ve antes de
        // mandarla. Enviar directo saca del medio al único que puede notar que
        // el texto no aplica a ese cliente.
        const hilo = await http().get(`/v1/inbox/${conversacionId}`)
          .set(...como(inmo)).expect(200);
        const salientes = hilo.body.mensajes.filter(
          (m: { direccion: string }) => m.direccion === 'saliente',
        );
        // Sólo lo que mandó el bot, nada de la plantilla.
        expect(salientes.every((m: { autorTipo: string }) => m.autorTipo === 'bot')).toBe(true);
      });

      it('deja el marcador a la vista cuando falta un dato', async () => {
        const sinNombre = await http().post('/v1/respuestas').set(...como(inmo))
          .send({ nombre: 'Sin dato', cuerpo: 'Hola {nombre}' }).expect(201);

        // Un hilo sin nombre de contacto.
        await http().post(webhook)
          .set('x-telegram-bot-api-secret-token', SECRETO)
          .send({ message: { message_id: 7002, text: 'hola', chat: { id: '710002' } } })
          .expect(200);

        const lista = await http().get('/v1/inbox?q=710002').set(...como(inmo)).expect(200);
        const r = await http().post(`/v1/respuestas/${sinNombre.body.id}/aplicar`)
          .set(...como(inmo)).send({ conversacionId: lista.body.items[0].id }).expect(201);

        expect(r.body.texto).toContain('{nombre}');
        expect(r.body.faltantes).toEqual(['nombre']);
      });
    });

    it('cero fuga: la vecina no ve las plantillas ajenas', async () => {
      const r = await http().get('/v1/respuestas').set(...como(vecina)).expect(200);
      expect(r.body).toEqual([]);
    });
  });

  describe('configuración del bot', () => {
    it('arranca con las reglas de fábrica y las muestra', async () => {
      const r = await http().get(`/v1/bot/${cuentaId}`).set(...como(inmo)).expect(200);
      expect(r.body.palabrasDeSalida).toContain('asesor');
      // Los valores de fábrica vienen aparte para poder volver atrás.
      expect(r.body.porDefecto.palabrasDeSalida).toContain('asesor');
    });

    it('el asesor no puede tocarlas', async () => {
      await http().get(`/v1/bot/${cuentaId}`).set(...como(inmo, 'agente')).expect(403);
    });

    it('se guardan y mandan sobre las de fábrica', async () => {
      await http().patch(`/v1/bot/${cuentaId}`).set(...como(inmo))
        .send({ palabrasDeSalida: ['humano', 'che'] }).expect(200);

      const r = await http().get(`/v1/bot/${cuentaId}`).set(...como(inmo)).expect(200);
      expect(r.body.palabrasDeSalida).toEqual(['humano', 'che']);
      // Lo que no se tocó sigue viniendo de fábrica: cambiar una palabra no
      // tiene por qué obligar a redefinir el ruteo entero.
      expect(r.body.ruteo.length).toBeGreaterThan(0);
    });

    it('una regla sin equipo la corta el DTO, en el borde', async () => {
      // 400 y no 422: lo agarra la validación de entrada, que es donde
      // corresponde. Llegar al servicio con esto sería llegar de más.
      await http().patch(`/v1/bot/${cuentaId}`).set(...como(inmo))
        .send({ ruteo: [{ palabras: ['algo'], equipo: '' }] }).expect(400);
    });

    it('una regla SIN PALABRAS la corta el servicio', async () => {
      // Ésta el DTO no la puede ver: `@IsArray()` acepta un array vacío. Y una
      // regla sin palabras no dispara nunca, así que deja el ruteo mudo sin
      // decir por qué —parece configurado y no hace nada—.
      await http().patch(`/v1/bot/${cuentaId}`).set(...como(inmo))
        .send({ ruteo: [{ palabras: [], equipo: 'ventas' }] }).expect(422);
    });

    describe('probar', () => {
      it('dice qué haría y por qué, sin mandar nada', async () => {
        const r = await http().post(`/v1/bot/${cuentaId}/probar`).set(...como(inmo))
          .send({ mensaje: 'che, me pasás con alguien?' }).expect(201);

        expect(r.body.decision.accion).toBe('escalar');
        expect(r.body.explicacion).toContain('hace falta una persona');
      });

      it('refleja las reglas EDITADAS, no las de fábrica', async () => {
        // Es el punto de la pantalla: ver el efecto de lo que uno acaba de
        // escribir. «che» no está en las de fábrica.
        const r = await http().post(`/v1/bot/${cuentaId}/probar`).set(...como(inmo))
          .send({ mensaje: 'che' }).expect(201);
        expect(r.body.decision.accion).toBe('escalar');
      });

      it('probar NO deja rastro en la bandeja', async () => {
        const antes = (await http().get('/v1/inbox').set(...como(inmo)).expect(200)).body.total;
        await http().post(`/v1/bot/${cuentaId}/probar`).set(...como(inmo))
          .send({ mensaje: 'quiero alquilar' }).expect(201);
        const despues = (await http().get('/v1/inbox').set(...como(inmo)).expect(200)).body.total;
        expect(despues).toBe(antes);
      });
    });
  });
});
