import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { crearApp, limpiarFixtures, PASSWORD } from './util';

/**
 * Rotación de refresh tokens y detección de reuso.
 *
 * Es el mecanismo que convierte "me robaron el token" en "el robo se detecta y
 * se cortan todas las sesiones", en vez de "el atacante entra durante 14 días".
 */

const COOKIE = 'bemo_inmo_rt';

function cookieDe(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const c = raw?.find((x) => x.startsWith(`${COOKIE}=`));
  if (!c) throw new Error('no vino la cookie de refresh');
  return c.split(';')[0];
}

describe('Sesiones: rotación y detección de reuso', () => {
  let app: INestApplication;
  const email = `rotacion@test.local`;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  async function registrar() {
    return request(app.getHttpServer())
      .post('/v1/auth/registrar')
      .send({
        inmobiliaria: 'TEST_rotacion',
        provincia: 'Mendoza',
        email,
        password: PASSWORD,
        nombre: 'Ana Titular',
      })
      .expect(201);
  }

  it('la cookie de refresh es httpOnly y está acotada a /v1/auth', async () => {
    const res = await registrar();
    const raw = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${COOKIE}=`),
    )!;

    // httpOnly es lo que impide que un XSS se lleve la sesión.
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
    // Path acotado: la cookie no viaja en cada request de la app, sólo en auth.
    expect(raw).toContain('Path=/v1/auth');
    // El refresh NO viaja en el cuerpo: si el JS pudiera leerlo, httpOnly no serviría.
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it('cada refresh emite un token nuevo y el anterior deja de servir', async () => {
    const primera = cookieDe(await registrar().catch(() => login()));

    const r1 = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', primera)
      .expect(201);

    const segunda = cookieDe(r1);
    expect(segunda).not.toBe(primera);

    // La segunda funciona.
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', segunda)
      .expect(201);
  });

  it('reusar un token ya consumido revoca TODAS las sesiones del usuario', async () => {
    const sesionA = cookieDe(await login());
    const sesionB = cookieDe(await login()); // otro dispositivo, otra familia

    // Se consume A una vez: ahora el token viejo quedó usado.
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', sesionA)
      .expect(201);

    // Alguien tenía una copia del token viejo y lo usa.
    const reuso = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', sesionA)
      .expect(401);

    expect(reuso.body.code).toBe('SESION_COMPROMETIDA');

    // Y la consecuencia: la sesión del OTRO dispositivo también murió. No
    // sabemos cuál de las dos es la del atacante, así que caen las dos.
    const otra = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', sesionB)
      .expect(401);

    expect(otra.body.code).toBe('SESION_INVALIDA');
  });

  it('el logout invalida la cadena y limpia la cookie', async () => {
    const sesion = cookieDe(await login());

    const out = await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Cookie', sesion)
      .expect(201);

    const limpiada = (out.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${COOKIE}=`),
    );
    expect(limpiada).toMatch(/bemo_inmo_rt=;/);

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', sesion)
      .expect(401);
  });

  it('un refresh inventado no revela nada', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', `${COOKIE}=inventadototalmente`)
      .expect(401);

    expect(res.body.code).toBe('SESION_INVALIDA');
  });

  function login() {
    return request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
  }
});
