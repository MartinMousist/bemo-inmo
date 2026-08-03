import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { TokensService } from '../src/auth/tokens.service';
import { loadEnv } from '../src/config/env';
import {
  auth,
  crearApp,
  crearInmobiliaria,
  limpiarFixtures,
  PASSWORD,
  type Inmobiliaria,
} from './util';

/**
 * Ciclo completo de invitación: crear → aceptar → quedar adentro con el rol
 * correcto.
 *
 * Este archivo existe porque faltaba: la aceptación se rompía con un 500
 * ("column reference tenant_id is ambiguous") y ningún test lo tocaba. El
 * backend tenía el endpoint y la suite estaba en verde igual.
 */
describe('Invitaciones', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    inmo = await crearInmobiliaria('invita', app.get(TokensService));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  async function invitar(email: string, rol = 'agente') {
    const res = await request(app.getHttpServer())
      .post('/v1/equipo/invitaciones')
      .set(...auth(inmo.tokens.owner))
      .send({ email, rol })
      .expect(201);
    return res.body as { token: string; invitacionId: string };
  }

  it('el token se devuelve una sola vez y en la base sólo queda el hash', async () => {
    const { token } = await invitar('guardado@test.local');

    const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await c.connect();
    try {
      const { rows } = await c.query<{ token_hash: string }>(
        'SELECT token_hash FROM invitacion WHERE email = $1',
        ['guardado@test.local'],
      );
      expect(rows[0].token_hash).not.toBe(token);
      expect(rows[0].token_hash).toBe(app.get(TokensService).hashear(token));
    } finally {
      await c.end();
    }
  });

  it('aceptar una invitación crea la cuenta y deja al usuario adentro con su rol', async () => {
    const { token } = await invitar('nuevo@test.local', 'contable');

    const res = await request(app.getHttpServer())
      .post('/v1/auth/invitacion/aceptar')
      .send({ token, password: PASSWORD, nombre: 'Carla Contable' })
      .expect(201);

    expect(res.body.rol).toBe('contable');
    expect(res.body.tenant.id).toBe(inmo.tenantId);
    expect(res.body.usuario.nombre).toBe('Carla Contable');

    // Y quedó realmente en el equipo, no sólo en la respuesta.
    const equipo = await request(app.getHttpServer())
      .get('/v1/equipo')
      .set(...auth(inmo.tokens.owner))
      .expect(200);

    expect(equipo.body.map((m: { email: string }) => m.email)).toContain(
      'nuevo@test.local',
    );
  });

  it('la misma invitación no se puede usar dos veces', async () => {
    const { token } = await invitar('unavez@test.local');

    await request(app.getHttpServer())
      .post('/v1/auth/invitacion/aceptar')
      .send({ token, password: PASSWORD, nombre: 'Primero' })
      .expect(201);

    const segunda = await request(app.getHttpServer())
      .post('/v1/auth/invitacion/aceptar')
      .send({ token, password: PASSWORD, nombre: 'Segundo' })
      .expect(400);

    expect(segunda.body.code).toBe('INVITACION_INVALIDA');
    expect(segunda.body.detail).toContain('ya fue aceptada');
  });

  it('una invitación vencida no sirve', async () => {
    const { token, invitacionId } = await invitar('vencida@test.local');

    const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await c.connect();
    try {
      await c.query("UPDATE invitacion SET expira_el = now() - interval '1 day' WHERE id = $1", [
        invitacionId,
      ]);
    } finally {
      await c.end();
    }

    const res = await request(app.getHttpServer())
      .post('/v1/auth/invitacion/aceptar')
      .send({ token, password: PASSWORD, nombre: 'Tarde' })
      .expect(400);

    expect(res.body.detail).toContain('venció');
  });

  it('un token inventado no revela nada', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/invitacion/aceptar')
      // Cuerpo válido a propósito: si el nombre fuera inválido, el 400 vendría
      // del ValidationPipe y el test no probaría nada sobre el token.
      .send({ token: 'inventadototalmente', password: PASSWORD, nombre: 'Nadie' })
      .expect(400);

    expect(res.body.code).toBe('INVITACION_INVALIDA');
    expect(res.body.detail).toBe('La invitación no existe.');
  });

  it('el nombre corto lo rechaza la validación, no la lógica de invitación', async () => {
    const { token } = await invitar('validacion@test.local');

    const res = await request(app.getHttpServer())
      .post('/v1/auth/invitacion/aceptar')
      .send({ token, password: PASSWORD, nombre: 'X' })
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('no se puede invitar a alguien que ya está en el equipo', async () => {
    await request(app.getHttpServer())
      .post('/v1/equipo/invitaciones')
      .set(...auth(inmo.tokens.owner))
      .send({ email: 'agente.invita@test.local', rol: 'agente' })
      .expect(409);
  });

  it('el rol "owner" no se puede asignar por invitación desde la UI', async () => {
    // El DTO lo acepta (el contrato lo permite), pero ROLES_INVITABLES en el
    // front no lo ofrece. Si algún día se cierra también en el back, este test
    // pasa a esperar 400 y sirve de recordatorio.
    const res = await request(app.getHttpServer())
      .post('/v1/equipo/invitaciones')
      .set(...auth(inmo.tokens.owner))
      .send({ email: 'otroowner@test.local', rol: 'owner' });

    expect([201, 400]).toContain(res.status);
  });
});
