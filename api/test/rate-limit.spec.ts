import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { crearApp, limpiarFixtures, PASSWORD } from './util';

/**
 * Límite de intentos en /auth.
 *
 * Hasta esta suite no había ninguno: se podían probar contraseñas de forma
 * indefinida. `bcrypt` a costo 12 hacía lento cada intento, lo que suena a
 * defensa y no lo es — el costo lo paga el servidor, no el atacante.
 *
 * Los topes reales están en `env.ts`. Acá se bajan a mano ANTES de levantar la
 * app: `crearApp()` limpia el cache de entorno, y los topes se resuelven en cada
 * request, así que el valor que se lee es el que se fija acá.
 */

const VENTANA = 1; // minuto
const TOPE_IP = 10;
const TOPE_CUENTA = 4;

describe('Límite de intentos en /auth', () => {
  let app: INestApplication;
  const previo = { ...process.env };

  beforeAll(async () => {
    await limpiarFixtures();
    process.env.RATE_LIMIT_VENTANA_MIN = String(VENTANA);
    process.env.RATE_LIMIT_LOGIN_IP = String(TOPE_IP);
    process.env.RATE_LIMIT_LOGIN_CUENTA = String(TOPE_CUENTA);
    process.env.RATE_LIMIT_REGISTRO_IP = '3';
    process.env.RATE_LIMIT_REFRESH_IP = '10000';
    app = await crearApp();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = previo;
    await limpiarFixtures();
  });

  /**
   * `trust proxy` está activo, así que `X-Forwarded-For` es lo que la app toma
   * como IP de origen. Es justamente lo que hay que poder simular: sin esto los
   * 300 tests comparten 127.0.0.1 y no se puede distinguir un contador del otro.
   */
  function intentar(email: string, ip: string) {
    return request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password: 'contrasena-incorrecta-1' });
  }

  it('el intento 11 desde la misma IP devuelve 429', async () => {
    const ip = '203.0.113.10';

    // Emails distintos en cada intento: así el que corta es el contador por IP y
    // no el de cuenta. Es exactamente el ataque que se quiere frenar — alguien
    // barriendo emails desde un solo lugar.
    for (let i = 0; i < TOPE_IP; i++) {
      const res = await intentar(`barrido-${i}@test.local`, ip);
      expect(res.status).toBe(401);
    }

    const res = await intentar('barrido-final@test.local', ip);
    expect(res.status).toBe(429);
    // El front lee `code`, no el texto. Ver common/app-error.ts.
    expect(res.body.code).toBe('DEMASIADOS_INTENTOS');
    expect(res.body.status).toBe(429);
    expect(res.headers['content-type']).toContain('application/problem+json');
    // Sin Retry-After un cliente razonable reintenta en loop.
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('el contador por cuenta frena el mismo ataque repartido entre muchas IPs', async () => {
    const email = 'victima@test.local';

    // Una IP distinta por intento: el contador por IP nunca llega a su tope.
    for (let i = 0; i < TOPE_CUENTA; i++) {
      const res = await intentar(email, `198.51.100.${i + 1}`);
      expect(res.status).toBe(401);
    }

    const res = await intentar(email, '198.51.100.200');
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('DEMASIADOS_INTENTOS');
  });

  it('el contador por cuenta ignora las mayúsculas del email', async () => {
    // El guard corre ANTES del ValidationPipe, así que lee el email crudo tal
    // como vino. Sin normalizar, `Ana@X.com` y `ana@x.com` serían dos contadores
    // distintos y alcanzaría con alternar mayúsculas para duplicar los intentos.
    for (let i = 0; i < TOPE_CUENTA; i++) {
      const res = await intentar(
        i % 2 ? 'MIXTA@Test.Local' : 'mixta@test.local',
        `192.0.2.${i + 1}`,
      );
      expect(res.status).toBe(401);
    }

    const res = await intentar('MIXTA@TEST.LOCAL', '192.0.2.200');
    expect(res.status).toBe(429);
  });

  it('una cuenta bloqueada no bloquea a las demás', async () => {
    const ip = '203.0.113.77';

    for (let i = 0; i < TOPE_CUENTA; i++) {
      expect((await intentar('quemada@test.local', ip)).status).toBe(401);
    }
    expect((await intentar('quemada@test.local', ip)).status).toBe(429);

    // Misma IP, otra cuenta: sigue pudiendo intentar. Si esto fallara, cualquiera
    // podría dejar afuera a una oficina entera quemando una sola cuenta.
    expect((await intentar('vecina@test.local', ip)).status).toBe(401);
  });

  it('el 429 no revela si el email existe', async () => {
    const ip = '203.0.113.88';
    const real = 'existe@test.local';

    await request(app.getHttpServer())
      .post('/v1/auth/registrar')
      .set('X-Forwarded-For', '203.0.113.250')
      .send({
        inmobiliaria: 'TEST_ratelimit',
        provincia: 'Mendoza',
        email: real,
        password: PASSWORD,
        nombre: 'Ana Existente',
      })
      .expect(201);

    for (let i = 0; i < TOPE_CUENTA; i++) {
      expect((await intentar(real, ip)).status).toBe(401);
    }
    const existente = await intentar(real, ip);

    for (let i = 0; i < TOPE_CUENTA; i++) {
      expect((await intentar('no-existe@test.local', ip)).status).toBe(401);
    }
    const inexistente = await intentar('no-existe@test.local', ip);

    // Mismo status, mismo código, mismo texto: el 429 no puede ser un oráculo de
    // qué emails están dados de alta.
    expect(existente.status).toBe(429);
    expect(inexistente.status).toBe(429);
    expect(existente.body.code).toBe(inexistente.body.code);
    expect(existente.body.detail).toBe(inexistente.body.detail);
  });

  it('registrar tiene su propio tope, más bajo', async () => {
    const ip = '203.0.113.99';
    const alta = (n: number) =>
      request(app.getHttpServer())
        .post('/v1/auth/registrar')
        .set('X-Forwarded-For', ip)
        .send({
          inmobiliaria: `TEST_alta_${n}`,
          provincia: 'Mendoza',
          email: `alta-${n}@test.local`,
          password: PASSWORD,
          nombre: 'Ana Alta',
        });

    for (let i = 0; i < 3; i++) expect((await alta(i)).status).toBe(201);
    expect((await alta(99)).status).toBe(429);
  });

  it('cerrar sesión y /yo no se limitan', async () => {
    const ip = '203.0.113.10'; // la IP que ya quedó bloqueada para login

    // /yo lo llama el front en CADA carga de página. Si estuviera limitado, una
    // oficina entera detrás de una sola IP se quedaría sin sesión a media mañana.
    for (let i = 0; i < TOPE_IP + 5; i++) {
      const salida = await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('X-Forwarded-For', ip);
      expect(salida.status).toBe(201);

      const yo = await request(app.getHttpServer())
        .get('/v1/auth/yo')
        .set('X-Forwarded-For', ip);
      // 401 porque no hay token: lo que importa es que NO sea 429.
      expect(yo.status).toBe(401);
    }
  });

  it('el contador de login no se comparte con el de registrar', async () => {
    // La misma IP bloqueada para login puede seguir registrando: los contadores
    // son por ruta. Si fueran uno solo, un ataque de login dejaría sin alta a
    // quien comparta la IP.
    const res = await request(app.getHttpServer())
      .post('/v1/auth/registrar')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({
        inmobiliaria: 'TEST_separado',
        provincia: 'Mendoza',
        email: 'separado@test.local',
        password: PASSWORD,
        nombre: 'Ana Separada',
      });
    expect(res.status).toBe(201);
  });
});
