import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { crearApp, limpiarFixtures } from './util';

/**
 * Request-id.
 *
 * Sin esto, diagnosticar algo en producción es `grep` sobre renglones sueltos:
 * con dos usuarios trabajando a la vez las líneas se intercalan y no hay forma
 * de saber cuáles van juntas.
 *
 * Lo que se prueba es el contrato que hace que eso sirva: el id sale en el
 * header, sale en el cuerpo del error, y es el MISMO en los dos.
 */
describe('Observabilidad: request-id', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const http = () => request(app.getHttpServer());

  it('toda respuesta trae X-Request-Id', async () => {
    const res = await http().get('/v1/health').expect(200);
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('cada request tiene el suyo', async () => {
    const a = await http().get('/v1/health').expect(200);
    const b = await http().get('/v1/health').expect(200);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  it('el error trae el MISMO id que el header', async () => {
    // Es lo que convierte "me dio error" en "ya lo veo": el usuario lee el id
    // en pantalla y es el mismo que se busca en el log.
    const res = await http().get('/v1/propiedades').expect(401);

    expect(res.body.requestId).toBeTruthy();
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    // Y sigue siendo un problem+json con su código: el id se suma, no reemplaza.
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('respeta el id que viene de afuera, para que la traza no se corte', async () => {
    // Una traza que arranca en un proxy o en otro servicio tiene que seguir
    // siendo la misma de punta a punta.
    const mio = 'traza-de-otro-servicio-123';
    const res = await http().get('/v1/health').set('X-Request-Id', mio).expect(200);
    expect(res.headers['x-request-id']).toBe(mio);
  });

  it('ignora un id de afuera absurdamente largo', async () => {
    // Es un valor de un tercero y termina en los logs: sin tope, cualquiera
    // puede inflar cada línea con 2 MB de basura.
    const res = await http()
      .get('/v1/health')
      .set('X-Request-Id', 'x'.repeat(5000))
      .expect(200);

    expect(res.headers['x-request-id']).not.toContain('xxxxx');
    expect(res.headers['x-request-id'].length).toBeLessThan(60);
  });

  it('un 404 de ruta inexistente también lo trae', async () => {
    const res = await http().get('/v1/no-existe-esta-ruta').expect(404);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});
