import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import { codigoEn } from '../src/auth/totp.motor';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, PASSWORD, type Inmobiliaria,
} from './util';

/**
 * Segundo factor de principio a fin (etapa 17.4).
 *
 * El camino completo: enrolarse, entrar en dos pasos, perder el teléfono y
 * entrar con un código de recuperación, y apagarlo.
 */
describe('Segundo factor', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  let email = '';
  let secreto = '';
  let recuperacion: string[] = [];

  const http = () => request(app.getHttpServer());
  const como = () => auth(inmo.tokens.owner);
  const ahora = () => Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    inmo = await crearInmobiliaria('dosfactores', app.get(TokensService));
    email = 'owner.dosfactores@test.local';
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const entrar = (password = PASSWORD) =>
    http().post('/v1/auth/login').send({ email, password });

  it('arranca apagado', async () => {
    const r = await http().get('/v1/cuenta/seguridad').set(...como()).expect(200);
    expect(r.body.activo).toBe(false);
  });

  it('sin segundo factor, el login entrega la sesión de una', async () => {
    const r = await entrar().expect(201);
    expect(r.body.accessToken).toBeDefined();
    expect(r.body.requiereSegundoFactor).toBeUndefined();
  });

  it('el alta devuelve el secreto y la URI del QR', async () => {
    const r = await http().post('/v1/cuenta/seguridad/2fa').set(...como()).expect(201);
    secreto = r.body.secreto;
    expect(secreto).toMatch(/^[A-Z2-7]+$/);
    expect(r.body.uri).toContain('otpauth://totp/');
    expect(r.body.uri).toContain(encodeURIComponent(email));
  });

  it('empezado pero SIN confirmar, el login sigue entrando derecho', async () => {
    // Es la razón por la que hay dos estados: quien abandona el alta a la mitad
    // —se le cerró la pestaña, escaneó con la app equivocada— no puede quedar
    // afuera de su propia cuenta sin haber hecho nada mal.
    const r = await entrar().expect(201);
    expect(r.body.accessToken).toBeDefined();
  });

  it('un código incorrecto no confirma nada', async () => {
    const r = await http().post('/v1/cuenta/seguridad/2fa/confirmar')
      .set(...como()).send({ codigo: '000000' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('CODIGO_INVALIDO');
  });

  it('con el código correcto queda activo y entrega los códigos de recuperación', async () => {
    const r = await http().post('/v1/cuenta/seguridad/2fa/confirmar')
      .set(...como()).send({ codigo: codigoEn(secreto, ahora()) }).expect(201);

    recuperacion = r.body.codigosRecuperacion;
    expect(recuperacion).toHaveLength(8);

    const estado = await http().get('/v1/cuenta/seguridad').set(...como()).expect(200);
    expect(estado.body.activo).toBe(true);
    expect(estado.body.codigosSinUsar).toBe(8);
  });

  describe('el login en dos pasos', () => {
    it('la contraseña sola ya no alcanza, y no viene ningún token', async () => {
      const r = await entrar().expect(201);
      expect(r.body.requiereSegundoFactor).toBe(true);
      expect(r.body.desafio).toBeDefined();
      // Lo importante: NO hay sesión todavía.
      expect(r.body.accessToken).toBeUndefined();
      // Ni cookie de refresh.
      expect(r.headers['set-cookie']).toBeUndefined();
    });

    it('el pase NO sirve como token de acceso', async () => {
      // Se firma con una clave derivada, distinta de la de los tokens. Es lo
      // que hace que esto sea imposible por construcción y no por acordarse de
      // mirar un campo.
      const { desafio } = (await entrar().expect(201)).body;
      await http().get('/v1/propiedades')
        .set('Authorization', `Bearer ${desafio}`).expect(401);
    });

    it('con el código del teléfono se entra', async () => {
      const { desafio } = (await entrar().expect(201)).body;

      const r = await http().post('/v1/auth/2fa')
        .send({ desafio, codigo: codigoEn(secreto, ahora()) }).expect(201);

      expect(r.body.accessToken).toBeDefined();
      expect(r.body.rol).toBe('owner');
    });

    it('un código equivocado no entra', async () => {
      const { desafio } = (await entrar().expect(201)).body;
      const r = await http().post('/v1/auth/2fa').send({ desafio, codigo: '000000' });
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('CODIGO_INVALIDO');
    });

    it('un pase inventado no entra', async () => {
      const r = await http().post('/v1/auth/2fa')
        .send({ desafio: 'no.es.un.pase', codigo: codigoEn(secreto, ahora()) });
      expect(r.status).toBe(401);
    });

    it('la contraseña equivocada sigue dando 401, sin pase', async () => {
      const r = await entrar('otra-contrasena-larga-1');
      expect(r.status).toBe(401);
      expect(r.body.desafio).toBeUndefined();
    });
  });

  describe('perdí el teléfono', () => {
    it('un código de recuperación entra igual', async () => {
      const { desafio } = (await entrar().expect(201)).body;

      const r = await http().post('/v1/auth/2fa')
        .send({ desafio, codigo: recuperacion[0] }).expect(201);
      expect(r.body.accessToken).toBeDefined();
    });

    it('y se quema: el mismo código no entra dos veces', async () => {
      const { desafio } = (await entrar().expect(201)).body;
      const r = await http().post('/v1/auth/2fa')
        .send({ desafio, codigo: recuperacion[0] });
      expect(r.status).toBe(401);
    });

    it('se descuenta del contador que ve la pantalla', async () => {
      const token = (await http().post('/v1/auth/2fa')
        .send({
          desafio: (await entrar()).body.desafio,
          codigo: codigoEn(secreto, ahora()),
        })).body.accessToken;

      const estado = await http().get('/v1/cuenta/seguridad')
        .set('Authorization', `Bearer ${token}`).expect(200);
      expect(estado.body.codigosSinUsar).toBe(7);
    });

    it('se acepta escrito a mano: sin guiones y en minúscula', async () => {
      const { desafio } = (await entrar().expect(201)).body;
      const aMano = recuperacion[1].replace(/-/g, '').toLowerCase();

      await http().post('/v1/auth/2fa').send({ desafio, codigo: aMano }).expect(201);
    });
  });

  describe('apagarlo', () => {
    it('no se puede sin un código vigente, aunque la sesión sea válida', async () => {
      // Si alcanzara con estar logueado, quien se roba una sesión abierta apaga
      // el segundo factor y se queda con la cuenta.
      const r = await http().post('/v1/cuenta/seguridad/2fa/desactivar')
        .set(...como()).send({ codigo: '000000' });
      expect(r.status).toBe(422);
    });

    it('con el código se apaga y el login vuelve a ser de un paso', async () => {
      await http().post('/v1/cuenta/seguridad/2fa/desactivar')
        .set(...como()).send({ codigo: codigoEn(secreto, ahora()) }).expect(201);

      const r = await entrar().expect(201);
      expect(r.body.accessToken).toBeDefined();
    });

    it('apagarlo borra los códigos de recuperación viejos', async () => {
      const estado = await http().get('/v1/cuenta/seguridad').set(...como()).expect(200);
      expect(estado.body.activo).toBe(false);
      expect(estado.body.codigosSinUsar).toBe(0);
    });
  });
});
