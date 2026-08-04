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
 * Etapa 9 — planes y límites.
 *
 * Lo único que importa acá: **los límites se APLICAN**. Un plan que sólo existe
 * en la pantalla de precios es un cartel, no un plan.
 */
describe('Planes, límites y API', () => {
  let app: INestApplication;
  let inmo: Inmobiliaria;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    inmo = await crearInmobiliaria('planes', app.get(TokensService));
    await ponerPlan(inmo.tenantId, 'medio');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures();
  });

  const como = (i: Inmobiliaria, rol: 'owner' | 'admin' | 'agente' | 'contable' = 'owner') =>
    auth(i.tokens[rol]);
  const http = () => request(app.getHttpServer());

  /** Cambia el plan por SQL: no hay endpoint para autoasignarse un plan. */
  async function ponerPlan(tenantId: string, plan: string) {
    const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await c.connect();
    try {
      await c.query(
        `INSERT INTO suscripcion (tenant_id, plan_codigo) VALUES ($1,$2)
         ON CONFLICT (tenant_id) DO UPDATE SET plan_codigo = $2`,
        [tenantId, plan],
      );
    } finally {
      await c.end();
    }
  }

  /** Cambia el tope del plan inicial. Tabla global: siempre restaurar. */
  async function topeDePropiedades(n: number) {
    const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await c.connect();
    try {
      await c.query(`UPDATE plan SET max_propiedades = $1 WHERE codigo = 'inicial'`, [n]);
    } finally {
      await c.end();
    }
  }

  it('el catálogo es público y NO trae precios inventados', async () => {
    const res = await request(app.getHttpServer()).get('/v1/planes').expect(200);

    expect(res.body).toHaveLength(4);
    // El gate de la etapa 0 es que alguien diga un número concreto. Hasta
    // entonces, precio null y no una cifra puesta a ojo.
    expect(res.body.every((p: { precio: null }) => p.precio === null)).toBe(true);

    const inicial = res.body.find((p: { codigo: string }) => p.codigo === 'inicial');
    expect(inicial.maxPropiedades).toBe(100);
    const pro = res.body.find((p: { codigo: string }) => p.codigo === 'pro');
    expect(pro.maxPropiedades).toBeNull();   // sin límite
  });

  it('mi-plan dice el estado REAL del cobro, sin simularlo', async () => {
    const res = await http().get('/v1/planes/mi-plan').set(...como(inmo)).expect(200);

    expect(res.body.plan.codigo).toBe('medio');
    expect(res.body.cobro.integrado).toBe(false);
    expect(res.body.cobro.detalle).toContain('medio de pago');
    // Y los límites vienen con lo usado de verdad.
    const props = res.body.limites.find((l: { recurso: string }) => l.recurso === 'propiedades');
    expect(props.maximo).toBe(500);
    expect(typeof props.usado).toBe('number');
  });

  it('el tope de propiedades se aplica de verdad', async () => {
    // El try/finally NO es decorativo: `plan` es una tabla GLOBAL y si una
    // aserción falla antes de restaurar, el tope queda tocado y rompe los
    // demás tests. Un test que muta estado compartido lo restaura pase lo que
    // pase.
    await topeDePropiedades(2);
    try {
      await ponerPlan(inmo.tenantId, 'inicial');

      await http().post('/v1/propiedades').set(...como(inmo))
        .send({ calle: 'Una', tipo: 'casa' }).expect(201);
      await http().post('/v1/propiedades').set(...como(inmo))
        .send({ calle: 'Dos', tipo: 'casa' }).expect(201);

      // La tercera choca. El corte viene del TRIGGER, así que no hay camino de
      // código que lo saltee, y llega como 403 con el motivo escrito.
      const res = await http().post('/v1/propiedades').set(...como(inmo))
        .send({ calle: 'Tres', tipo: 'casa' })
        .expect(403);

      expect(res.body.code).toBe('LIMITE_DE_PLAN');
      expect(res.body.detail).toContain('tope de 2 propiedades');
      expect(res.body.detail).toContain('plan superior');
    } finally {
      await topeDePropiedades(100);
      await ponerPlan(inmo.tenantId, 'medio');
    }
  });

  it('un módulo fuera del plan devuelve 403 con el motivo', async () => {
    await ponerPlan(inmo.tenantId, 'inicial');

    const res = await http().get('/v1/sucursales').set(...como(inmo)).expect(403);
    expect(res.body.code).toBe('MODULO_NO_INCLUIDO');
    expect(res.body.detail).toContain('multisucursal');

    await ponerPlan(inmo.tenantId, 'medio');
  });

  it('con el plan Pro, multisucursal y API funcionan', async () => {
    await ponerPlan(inmo.tenantId, 'pro');

    await http().post('/v1/sucursales').set(...como(inmo))
      .send({ nombre: 'Centro' }).expect(201);
    const suc = await http().get('/v1/sucursales').set(...como(inmo)).expect(200);
    expect(suc.body).toHaveLength(1);

    const clave = await http().post('/v1/api-keys').set(...como(inmo))
      .send({ nombre: 'Integración propia' }).expect(201);

    expect(clave.body.clave).toMatch(/^bemo_/);
    expect(clave.body.aviso).toContain('no se vuelve a mostrar');

    // En el listado NO vuelve a aparecer la clave, sólo el prefijo.
    const lista = await http().get('/v1/api-keys').set(...como(inmo)).expect(200);
    expect(lista.body[0].prefijo).toBe(clave.body.clave.slice(0, 12));
    expect(JSON.stringify(lista.body)).not.toContain(clave.body.clave);
  });

  it('en la base sólo queda el hash de la clave, nunca la clave', async () => {
    await ponerPlan(inmo.tenantId, 'pro');
    const clave = await http().post('/v1/api-keys').set(...como(inmo))
      .send({ nombre: 'Otra' }).expect(201);

    const c = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await c.connect();
    try {
      const { rows } = await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM api_key WHERE clave_hash = $1',
        [clave.body.clave],
      );
      expect(Number(rows[0].n)).toBe(0);
    } finally {
      await c.end();
    }
  });

  it('revocar una clave dos veces no funciona', async () => {
    await ponerPlan(inmo.tenantId, 'pro');
    const clave = await http().post('/v1/api-keys').set(...como(inmo))
      .send({ nombre: 'Revocable' }).expect(201);

    await http().delete(`/v1/api-keys/${clave.body.id}`).set(...como(inmo)).expect(200);
    await http().delete(`/v1/api-keys/${clave.body.id}`).set(...como(inmo)).expect(404);
  });

  it('sólo el titular administra sucursales y claves', async () => {
    await ponerPlan(inmo.tenantId, 'pro');
    await http().post('/v1/sucursales').set(...como(inmo, 'admin'))
      .send({ nombre: 'Sur' }).expect(403);
    await http().get('/v1/api-keys').set(...como(inmo, 'admin')).expect(403);
  });

  describe('export CSV', () => {
    it('trae BOM y separador de punto y coma', async () => {
      const res = await http().get('/v1/exportar/propiedades.csv')
        .set(...como(inmo)).expect(200);

      // Sin BOM, Excel en Windows rompe los acentos.
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
      expect(res.text.split('\r\n')[0]).toContain(';');
      expect(res.headers['content-disposition']).toContain('.csv');
    });

    it('neutraliza las fórmulas de Excel', async () => {
      await http().post('/v1/personas').set(...como(inmo))
        .send({ nombre: '=1+1', apellido: 'Inyeccion' }).expect(201);

      const res = await http().get('/v1/exportar/personas.csv')
        .set(...como(inmo)).expect(200);

      // Un valor que arranca con "=" lo ejecuta Excel al abrir el archivo.
      expect(res.text).toContain("'=1+1");
      expect(res.text).not.toMatch(/(^|;)=1\+1/m);
    });

    it('un recurso que no existe dice cuáles sí', async () => {
      const res = await http().get('/v1/exportar/inventado.csv')
        .set(...como(inmo)).expect(404);
      expect(res.body.detail).toContain('propiedades');
    });

    it('el asesor no puede exportar', async () => {
      await http().get('/v1/exportar/liquidaciones.csv')
        .set(...como(inmo, 'agente')).expect(403);
    });
  });
});
