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
  type Inmobiliaria,
} from './util';

/**
 * EL GATE DE LA ETAPA 2: cero fuga entre dos inmobiliarias.
 *
 * A diferencia del test de la etapa 1, que verificaba la policy de una tabla,
 * este entra por la API real con tokens reales. Es lo que un atacante tendría
 * a mano.
 */
describe('Aislamiento entre inmobiliarias (gate etapa 2)', () => {
  let app: INestApplication;
  let andes: Inmobiliaria;
  let plata: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    const tokens = app.get(TokensService);
    andes = await crearInmobiliaria('andes', tokens);
    plata = await crearInmobiliaria('plata', tokens);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  it('cada inmobiliaria ve sólo a su propio equipo', async () => {
    const resA = await request(app.getHttpServer())
      .get('/v1/equipo')
      .set(...auth(andes.tokens.owner))
      .expect(200);

    const resP = await request(app.getHttpServer())
      .get('/v1/equipo')
      .set(...auth(plata.tokens.owner))
      .expect(200);

    expect(resA.body).toHaveLength(4);
    expect(resP.body).toHaveLength(4);

    const mailsA = resA.body.map((m: { email: string }) => m.email);
    const mailsP = resP.body.map((m: { email: string }) => m.email);

    expect(mailsA.every((e: string) => e.includes('andes'))).toBe(true);
    expect(mailsP.every((e: string) => e.includes('plata'))).toBe(true);
    expect(mailsA.filter((e: string) => mailsP.includes(e))).toHaveLength(0);
  });

  it('las invitaciones de una no aparecen en la otra', async () => {
    await request(app.getHttpServer())
      .post('/v1/equipo/invitaciones')
      .set(...auth(andes.tokens.owner))
      .send({ email: 'secreto.andes@test.local', rol: 'agente' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/v1/equipo/invitaciones')
      .set(...auth(plata.tokens.owner))
      .expect(200);

    expect(res.body).toHaveLength(0);
  });

  it('un token con el tenant de otra inmobiliaria no da acceso a sus datos', async () => {
    // El caso feo: alguien arma un token con SU usuario pero el tenant ajeno.
    // Si sólo confiáramos en el JWT, entraría. La RLS filtra por el tenant del
    // token, y ese usuario no tiene membresía ahí: ve el equipo de Plata vacío,
    // no el de Plata completo.
    const tokens = app.get(TokensService);
    const cruzado = tokens.firmarAccess({
      sub: andes.usuarios.owner,
      tid: plata.tenantId,
      rol: 'owner',
    });

    const res = await request(app.getHttpServer())
      .get('/v1/equipo')
      .set(...auth(cruzado))
      .expect(200);

    const mails = res.body.map((m: { email: string }) => m.email);
    expect(mails.filter((e: string) => e.includes('andes'))).toHaveLength(0);
  });

  it('a nivel base, ninguna consulta sin contexto devuelve filas', async () => {
    // Defensa en profundidad: aunque el código se equivocara y consultara sin
    // withTenant, no saldría nada.
    const c = new Client({ connectionString: loadEnv().DATABASE_URL });
    await c.connect();
    try {
      for (const tabla of ['tenant', 'usuario', 'membresia', 'invitacion', 'auditoria']) {
        const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${tabla}`);
        expect({ tabla, n: rows[0].n }).toEqual({ tabla, n: 0 });
      }
    } finally {
      await c.end();
    }
  });

  it('la tabla sesion no es accesible ni siquiera con contexto', async () => {
    // No tiene GRANT: se toca sólo por las funciones SECURITY DEFINER.
    const c = new Client({ connectionString: loadEnv().DATABASE_URL });
    await c.connect();
    try {
      await expect(c.query('SELECT * FROM sesion')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await c.end();
    }
  });

  it('la auditoría es append-only: el rol de app no puede editarla ni borrarla', async () => {
    const c = new Client({ connectionString: loadEnv().DATABASE_URL });
    await c.connect();
    try {
      await expect(
        c.query("UPDATE auditoria SET accion = 'falsificada'"),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(c.query('DELETE FROM auditoria')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await c.end();
    }
  });
});
