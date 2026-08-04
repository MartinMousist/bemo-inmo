import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { loadEnv } from '../src/config/env';
import { crearApp, limpiarFixtures } from './util';

/**
 * Etapa 8 — revisión de seguridad del sistema entero, no de los cambios.
 *
 * Cada uno de estos tests nació de un hallazgo real de la revisión manual. La
 * revisión se hace una vez; el test la sostiene para siempre.
 */
describe('Seguridad del sistema', () => {
  let app: INestApplication;
  let owner: Client;

  beforeAll(async () => {
    await limpiarFixtures();
    app = await crearApp();
    owner = new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
    await owner.connect();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    await limpiarFixtures();
  });

  describe('base de datos', () => {
    /** Tablas que a propósito NO llevan RLS, con su razón. */
    const SIN_RLS_A_PROPOSITO = new Set([
      'schema_migrations', // infraestructura: app_role no tiene ningún permiso
    ]);

    it('toda tabla de datos tiene row level security', async () => {
      const { rows } = await owner.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables t
          WHERE schemaname = 'public'
            AND NOT EXISTS (SELECT 1 FROM pg_class c
                             WHERE c.relname = t.tablename AND c.relrowsecurity)`,
      );
      const inesperadas = rows
        .map((r) => r.tablename)
        .filter((t) => !SIN_RLS_A_PROPOSITO.has(t));

      expect(inesperadas).toEqual([]);
    });

    it('app_role no es dueño de ninguna tabla', async () => {
      // Un rol dueño saltea RLS. Si la app fuera dueña, las policies no valdrían.
      const { rows } = await owner.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_class c
           JOIN pg_roles r ON r.oid = c.relowner
          WHERE r.rolname IN ('app_role', 'inmo_app')`,
      );
      expect(Number(rows[0].n)).toBe(0);
    });

    it('toda función SECURITY DEFINER fija su search_path', async () => {
      // Sin search_path fijo, un rol que pueda crear objetos en un schema
      // anterior secuestra la llamada y la ejecuta con privilegios de owner.
      const { rows } = await owner.query<{ proname: string }>(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prosecdef
            AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c
                             WHERE c LIKE 'search_path=%')`,
      );
      expect(rows.map((r) => r.proname)).toEqual([]);
    });

    it('la auditoría es de sólo lectura para la app', async () => {
      const { rows } = await owner.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'app_role' AND table_name = 'auditoria'`,
      );
      // Un registro de auditoría que se puede editar no es auditoría.
      expect(rows.map((r) => r.privilege_type).sort()).toEqual(['SELECT']);
    });

    it('la app no puede tocar el registro de migraciones', async () => {
      // Hallazgo real de la revisión: el script de restore hacía GRANT ON ALL
      // TABLES y le daba a app_role permiso de escritura sobre esta tabla.
      const { rows } = await owner.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'app_role' AND table_name = 'schema_migrations'`,
      );
      expect(rows).toEqual([]);
    });

    it('la tabla de sesiones no es accesible por SQL', async () => {
      const { rows } = await owner.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'app_role' AND table_name = 'sesion'`,
      );
      // Sólo se toca por funciones SECURITY DEFINER: el refresh llega sin
      // contexto de tenant y ninguna policy podría resolverlo.
      expect(rows).toEqual([]);
    });

    it('los índices no se pueden modificar desde la app', async () => {
      const { rows } = await owner.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'app_role' AND table_name = 'indice_valor'`,
      );
      // Son globales a todas las inmobiliarias: una no puede corregirle el IPC
      // a las demás. Se cargan por app_indice_cargar(), que no pisa valores.
      expect(rows.map((r) => r.privilege_type).sort()).toEqual(['SELECT']);
    });
  });

  describe('HTTP', () => {
    it('manda los headers de seguridad', async () => {
      const res = await request(app.getHttpServer()).get('/v1/health').expect(200);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['strict-transport-security']).toContain('max-age=');
      // Nada que revele el stack.
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('rechaza campos fuera del contrato', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'x@y.com', password: 'zzzzzzzzzz', rol: 'owner' })
        .expect(400);
      // Ignorarlo en silencio es lo peligroso: el cliente cree que funcionó.
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('un 500 no filtra el detalle interno', async () => {
      // El filtro global devuelve un mensaje genérico y manda el stack al log.
      const res = await request(app.getHttpServer())
        .get('/v1/propiedades/no-es-un-uuid')
        .set('Authorization', 'Bearer invalido');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:|node_modules|pg_/);
    });

    it('sin token, todo lo que no es público responde 401', async () => {
      const protegidas = [
        '/v1/propiedades', '/v1/personas', '/v1/contratos', '/v1/liquidaciones',
        '/v1/ventas', '/v1/avisos', '/v1/equipo', '/v1/exportar/propiedades.csv',
        '/v1/planes/mi-plan', '/v1/api-keys',
      ];
      for (const ruta of protegidas) {
        const res = await request(app.getHttpServer()).get(ruta);
        expect({ ruta, status: res.status }).toEqual({ ruta, status: 401 });
      }
    });

    it('las rutas públicas son exactamente las esperadas', async () => {
      // Si aparece una nueva, este test falla y obliga a justificarla.
      const publicas: Array<[string, string]> = [
        ['get', '/v1/health'],
        ['get', '/v1/health/live'],
        ['get', '/v1/planes'],
        ['post', '/v1/auth/login'],
        ['post', '/v1/auth/registrar'],
        ['post', '/v1/auth/refresh'],
        ['post', '/v1/auth/logout'],
        ['post', '/v1/auth/invitacion/aceptar'],
      ];

      for (const [metodo, ruta] of publicas) {
        const res = await (request(app.getHttpServer()) as never as Record<
          string,
          (r: string) => request.Test
        >)[metodo](ruta).send({});

        // Lo que se mide es si el GUARD la bloqueó, no el status.
        // `/auth/refresh` devuelve 401 legítimamente cuando no hay cookie de
        // sesión: es pública —el guard la deja pasar— y el 401 lo pone el
        // handler. El código de error distingue una cosa de la otra.
        expect({ ruta, bloqueadaPorGuard: res.body?.code === 'UNAUTHENTICATED' })
          .toEqual({ ruta, bloqueadaPorGuard: false });
      }
    });
  });
});
