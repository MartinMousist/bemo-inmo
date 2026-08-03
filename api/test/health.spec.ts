import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/problem-details.filter';
import { resetEnvCache } from '../src/config/env';

/**
 * Se levanta la app REAL: mismo módulo, mismos pipes, mismo filtro de errores.
 * Una app armada distinta para los tests prueba una app que no existe.
 */
describe('Health y contrato de error', () => {
  let app: INestApplication;

  beforeAll(async () => {
    resetEnvCache();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalFilters(new ProblemDetailsFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('GET /v1/health/live responde sin tocar la base', async () => {
    await request(app.getHttpServer())
      .get('/v1/health/live')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('GET /v1/health verifica la base', async () => {
    await request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect({ status: 'ok', db: 'ok' });
  });

  it('una ruta inexistente devuelve RFC 9457 con código estable', async () => {
    const res = await request(app.getHttpServer()).get('/v1/no-existe').expect(404);

    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      type: 'about:blank',
      status: 404,
      code: 'NOT_FOUND',
      instance: '/v1/no-existe',
    });
    expect(typeof res.body.detail).toBe('string');
  });
});
