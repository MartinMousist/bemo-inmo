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
  /** Una foto de 8 MB en base64 son ~11 MB. */
  BODY_LIMIT_FOTOS: z.string().default('14mb'),
  BODY_LIMIT_IMPORTAR: z.string().default('6mb'),

  /**
   * Secreto de firma de los access tokens. Sin default: si falta, la app no
   * levanta. Un default acá sería una clave de producción que nadie configuró.
   * Mínimo 32 caracteres — una clave corta se rompe por fuerza bruta.
   */
  JWT_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres'),

  /** Access token corto: si se filtra, la ventana de daño es chica. */
  ACCESS_TTL_MIN: z.coerce.number().int().positive().max(60).default(15),
  /** Refresh largo, pero rota en cada uso. */
  REFRESH_TTL_DIAS: z.coerce.number().int().positive().max(90).default(14),

  /**
   * Dominio de la cookie de refresh. Vacío = el host exacto, que es lo correcto.
   * NUNCA poner `.bemo.com.ar`: una cookie de dominio padre la comparten todos
   * los subdominios, y un XSS en cualquier producto del grupo alcanzaría esta
   * sesión.
   */
  COOKIE_DOMAIN: z.string().default(''),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),

  /**
   * Opcional a propósito. Sin key la app funciona igual: no geocodifica, no
   * inventa coordenadas, y la UI ofrece cargar lat/lng a mano diciendo por qué.
   * Un default falso acá sería una propiedad ubicada en el medio del océano.
   */
  GOOGLE_MAPS_API_KEY: z.string().default(''),

  /**
   * Almacenamiento S3. Opcional: sin bucket la app funciona igual, sólo que no
   * acepta fotos y lo dice. Un default inventado apuntaría a un bucket ajeno.
   */
  S3_ENDPOINT: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_PUBLIC_URL: z.string().default(''),
});

type Crudo = z.infer<typeof schema>;

export type Env = Omit<
  Crudo,
  'MIGRATE_ON_BOOT' | 'SEED_ON_BOOT' | 'COOKIE_SECURE'
> & {
  MIGRATE_ON_BOOT: boolean;
  SEED_ON_BOOT: boolean;
  COOKIE_SECURE: boolean;
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
    COOKIE_SECURE: e.COOKIE_SECURE === 'true',
    isProduction: e.NODE_ENV === 'production',
  };

  if (cached.isProduction) {
    if (cached.SEED_ON_BOOT) {
      throw new Error('SEED_ON_BOOT no puede estar activo en producción.');
    }
    if (!cached.COOKIE_SECURE) {
      throw new Error('COOKIE_SECURE tiene que ser true en producción.');
    }
    if (cached.COOKIE_DOMAIN.startsWith('.')) {
      throw new Error(
        `COOKIE_DOMAIN no puede ser un dominio padre ("${cached.COOKIE_DOMAIN}"): ` +
          'la cookie de sesión quedaría compartida con todos los subdominios.',
      );
    }
  }

  return cached;
}

/** Sólo para tests, que necesitan reevaluar el entorno. */
export function resetEnvCache(): void {
  cached = null;
}
