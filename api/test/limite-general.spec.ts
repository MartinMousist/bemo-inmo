import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokensService } from '../src/auth/tokens.service';
import {
  auth, crearApp, crearInmobiliaria, limpiarFixtures, type Inmobiliaria,
} from './util';

/**
 * El techo de uso normal de la app (etapa 17.4).
 *
 * ── Qué protege, que no es lo mismo que `/auth` ──
 *
 * Los contadores de `/auth` protegen contraseñas. Éste protege de **un token
 * que ya es válido**: una sesión robada, o la cuenta de alguien que se fue y
 * todavía no se dio de baja, podía recorrer `/propiedades?pagina=1..N` a
 * velocidad de máquina y bajarse la cartera entera sin que nada lo notara.
 *
 * ── Por qué por usuario y no por IP ──
 *
 * Una inmobiliaria entera sale por la misma conexión. Contar por IP le pondría
 * a las diez personas de la oficina el cupo de una, y el sistema empezaría a
 * cortar justo los martes a la mañana.
 */

const TOPE = 8;

describe('Límite general de uso', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;
  const previo = { ...process.env };

  beforeAll(async () => {
    await limpiarFixtures();
    process.env.RATE_LIMIT_GENERAL = String(TOPE);
    process.env.RATE_LIMIT_GENERAL_VENTANA_MIN = '1';
    // Antes de `crearApp()`: los topes se resuelven en cada request pero contra
    // el entorno CACHEADO, y el cache lo limpia el arranque de la app. Puesto
    // después, el tope que se lee es el default y el test no prueba nada.
    process.env.RATE_LIMIT_TERCEROS = '1';
    app = await crearApp();
    inmo = await crearInmobiliaria('limite', app.get(TokensService));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = previo;
    await limpiarFixtures();
  });

  const pedir = (token: string, ip = '198.51.100.1') =>
    request(app.getHttpServer())
      .get('/v1/propiedades')
      .set('X-Forwarded-For', ip)
      .set(...auth(token));

  it('deja trabajar hasta el tope y corta después', async () => {
    for (let i = 0; i < TOPE; i++) {
      expect((await pedir(inmo.tokens.owner)).status).toBe(200);
    }

    const cortado = await pedir(inmo.tokens.owner);
    expect(cortado.status).toBe(429);
    // Mismo contrato de error que todo lo demás: el front lee `code`.
    expect(cortado.body.code).toBe('DEMASIADOS_INTENTOS');
    expect(cortado.headers['retry-after']).toBeDefined();
  });

  it('el cupo es de cada usuario, aunque compartan la IP de la oficina', async () => {
    // El owner ya está pasado de su tope por el test anterior. Si el contador
    // fuera por IP, el asesor —misma oficina, misma IP— nacería bloqueado.
    expect((await pedir(inmo.tokens.agente)).status).toBe(200);
  });

  it('las llamadas a un tercero se cuentan por inmobiliaria, no por persona', async () => {
    // La cuota del BCRA la limita el BCRA, por la IP de NUESTRO servidor: es
    // una sola para todo el despliegue. Si el tope fuera por usuario, cinco
    // asesores de la misma agencia la queman igual y las otras inmobiliarias
    // se quedan sin poder verificar un garante por algo que no hicieron.
    //
    // Acá se prueba la UNIDAD de conteo, que es la decisión: el segundo pedido
    // sale del cupo de la inmobiliaria aunque lo haga otra persona.
    const inexistente = '00000000-0000-4000-8000-000000000000';
    const consultar = (token: string) =>
      request(app.getHttpServer())
        .post(`/v1/garantes/${inexistente}/bcra`)
        .set('X-Forwarded-For', '198.51.100.9')
        .set(...auth(token));

    // El garante no existe, así que la respuesta es 404 —lo que importa acá es
    // que el contador ya sumó: el guard corre antes que el handler—.
    const primera = await consultar(inmo.tokens.owner);
    expect(primera.status).not.toBe(429);

    // Otra PERSONA de la misma inmobiliaria: si contara por usuario, pasaría.
    const segunda = await consultar(inmo.tokens.agente);
    expect(segunda.status).toBe(429);
  });

  it('no le come el cupo al login: son contadores distintos', async () => {
    // `/auth` está marcado como ruta estricta, así que el contador general se
    // saltea ahí. Si no fuera así, un ataque de contraseñas contra una cuenta
    // le gastaría a esa persona su cupo de trabajo del día.
    const r = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.1')
      .send({ email: 'no-existe@test.local', password: 'loquesea1234' });

    expect(r.status).not.toBe(429);
  });
});
