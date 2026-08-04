import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { loadEnv, resetEnvCache } from '../src/config/env';
import { TokensService, type Rol } from '../src/auth/tokens.service';

export const ROLES: Rol[] = ['owner', 'admin', 'agente', 'contable'];
export const PASSWORD = 'unaclavelarga1';

/** Se hashea una sola vez: bcrypt a costo 12 son ~250 ms por llamada. */
let hashCache: string | null = null;
async function hashPassword(): Promise<string> {
  hashCache ??= await bcrypt.hash(PASSWORD, 12);
  return hashCache;
}

export interface Inmobiliaria {
  tenantId: string;
  nombre: string;
  /** Un token de acceso por rol. */
  tokens: Record<Rol, string>;
  usuarios: Record<Rol, string>;
}

export async function crearApp(): Promise<INestApplication> {
  resetEnvCache();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  // La app REAL: se configura con la MISMA función que main.ts. Duplicar la
  // configuración fue lo que hizo que el arnés no tuviera helmet y la suite
  // corriera contra una app distinta de la que se despliega.
  const app = moduleRef.createNestApplication();
  configurarApp(app);

  // listen(0) y no init(): supertest, si el server NO está escuchando, hace
  // listen(0) por cada request. Con requests en paralelo eso abre varios
  // listeners sobre el mismo server y las conexiones se caen con ECONNRESET
  // — que parece un bug de concurrencia de la app y es del arnés de test.
  await app.listen(0);
  return app;
}

function ownerClient(): Client {
  return new Client({ connectionString: loadEnv().DATABASE_OWNER_URL });
}

/** Borra todo lo que dejaron corridas anteriores. */
export async function limpiarFixtures(): Promise<void> {
  const c = ownerClient();
  await c.connect();
  try {
    await c.query("DELETE FROM tenant WHERE nombre LIKE 'TEST\\_%'");
    await c.query("DELETE FROM usuario WHERE email LIKE '%@test.local'");
  } finally {
    await c.end();
  }
}

/**
 * Crea una inmobiliaria con un usuario por cada rol, y devuelve un access token
 * para cada uno. Se arma con el rol OWNER de la base a propósito: es setup, no
 * es lo que se está probando.
 */
export async function crearInmobiliaria(
  slug: string,
  tokens: TokensService,
): Promise<Inmobiliaria> {
  const c = ownerClient();
  await c.connect();
  try {
    const nombre = `TEST_${slug}`;
    const { rows: t } = await c.query<{ id: string }>(
      'INSERT INTO tenant (nombre, provincia) VALUES ($1, $2) RETURNING id',
      [nombre, 'Mendoza'],
    );
    const tenantId = t[0].id;

    const hash = await hashPassword();
    const usuarios = {} as Record<Rol, string>;
    const accesos = {} as Record<Rol, string>;

    for (const rol of ROLES) {
      const { rows: u } = await c.query<{ id: string }>(
        'INSERT INTO usuario (email, password_hash, nombre) VALUES ($1, $2, $3) RETURNING id',
        [`${rol}.${slug}@test.local`, hash, `${rol} de ${slug}`],
      );
      const usuarioId = u[0].id;
      await c.query(
        'INSERT INTO membresia (tenant_id, usuario_id, rol) VALUES ($1, $2, $3)',
        [tenantId, usuarioId, rol],
      );
      usuarios[rol] = usuarioId;
      accesos[rol] = tokens.firmarAccess({ sub: usuarioId, tid: tenantId, rol });
    }

    return { tenantId, nombre, tokens: accesos, usuarios };
  } finally {
    await c.end();
  }
}

export function auth(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}
