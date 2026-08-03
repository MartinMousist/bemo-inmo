import { z } from 'zod';

/**
 * Validación de entorno al arrancar.
 *
 * Si falta un secreto, la app NO levanta. Nunca un default inseguro: un default
 * que "funciona" es un secreto de producción que nadie configuró y nadie notó.
 * Los únicos defaults son los que no tienen consecuencia de seguridad (puerto,
 * flags de desarrollo).
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  /** Rol restringido. Es el que usa la app en cada request y al que le aplica RLS. */
  DATABASE_URL: z.string().url(),

  /** Rol dueño del schema. Sólo el migrador y el seed. */
  DATABASE_OWNER_URL: z.string().url(),

  MIGRATE_ON_BOOT: z.enum(['true', 'false']).default('false'),
  SEED_ON_BOOT: z.enum(['true', 'false']).default('false'),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  BODY_LIMIT: z.string().default('1mb'),
});

export type Env = Omit<z.infer<typeof schema>, 'MIGRATE_ON_BOOT' | 'SEED_ON_BOOT'> & {
  MIGRATE_ON_BOOT: boolean;
  SEED_ON_BOOT: boolean;
  isProduction: boolean;
};

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('\n');
    // No usamos el logger de Nest: esto pasa antes de que exista la app.
    throw new Error(`Configuración de entorno inválida:\n${detalle}\n`);
  }

  const e = parsed.data;
  cached = {
    ...e,
    MIGRATE_ON_BOOT: e.MIGRATE_ON_BOOT === 'true',
    SEED_ON_BOOT: e.SEED_ON_BOOT === 'true',
    isProduction: e.NODE_ENV === 'production',
  };

  if (cached.isProduction && cached.SEED_ON_BOOT) {
    throw new Error('SEED_ON_BOOT no puede estar activo en producción.');
  }

  return cached;
}

/** Sólo para tests, que necesitan reevaluar el entorno. */
export function resetEnvCache(): void {
  cached = null;
}
