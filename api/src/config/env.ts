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

  /**
   * Trae ICL y UVA del BCRA solo, cada 12 h.
   *
   * Apagado por defecto **a propósito**: prendido, cualquier `npm test` o
   * cualquier arranque de un script sale a internet a consultar el BCRA. Se
   * prende donde hay una instancia sirviendo de verdad, que es el único lugar
   * donde tiene sentido. El IPC no entra acá: INDEC no tiene API estable y la
   * carga manual es deliberada.
   */
  SINCRONIZAR_INDICES: z.enum(['true', 'false']).default('false'),

  /**
   * Log en JSON, una línea por evento. Por defecto sigue el entorno: en
   * producción JSON —es lo único que un agregador puede filtrar por requestId—
   * y en desarrollo el formato legible de Nest.
   */
  LOG_JSON: z.enum(['true', 'false']).optional(),

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

  /**
   * El secreto ANTERIOR, mientras dura una rotación.
   *
   * Sin esto, cambiar `JWT_SECRET` desloguea a todo el mundo en el acto: cada
   * access token vivo deja de verificar de golpe. Eso hace que rotar duela, y
   * un secreto que duele rotar no se rota nunca —que es el estado en el que
   * está la mayoría de los sistemas que tuvieron una filtración—.
   *
   * Se firma SIEMPRE con el nuevo; el viejo sólo verifica. Se saca cuando pasó
   * el `ACCESS_TTL_MIN`, que es lo que tardan en morirse solos los últimos
   * tokens firmados con él.
   */
  JWT_SECRET_ANTERIOR: z.string().min(32, 'debe tener al menos 32 caracteres').optional(),

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
   * El contador del límite de intentos, en la base en vez de en la memoria del
   * proceso. Hace falta si se despliega más de una réplica: con dos, cada una
   * lleva su propio contador y el límite efectivo se duplica en silencio.
   *
   * Por defecto sigue el entorno: en producción sí, en desarrollo y en tests no
   * —una suite que prueba 429 escribiría en la base en cada request.
   */
  RATE_LIMIT_EN_BASE: z.enum(['true', 'false']).optional(),

  /**
   * Límite de intentos en las rutas públicas de autenticación.
   *
   * Antes no había ninguno. `bcrypt` a costo 12 hace lento cada intento, pero eso
   * no frena un ataque sostenido: lo único que logra es que el ataque le cueste
   * más CPU al servidor que al atacante.
   *
   * Dos contadores independientes y complementarios:
   *  - por IP: frena a alguien probando muchas contraseñas desde un lugar.
   *  - por cuenta: frena el mismo ataque repartido entre muchas IPs. Va más alto
   *    a propósito — si fuera bajo, cualquiera podría dejar afuera a un usuario
   *    real quemándole los intentos.
   */
  RATE_LIMIT_VENTANA_MIN: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_LOGIN_IP: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_LOGIN_CUENTA: z.coerce.number().int().positive().default(20),
  /** Crear inmobiliarias es caro y raro: una persona no abre cinco por hora. */
  RATE_LIMIT_REGISTRO_IP: z.coerce.number().int().positive().default(5),
  /**
   * El refresh lo llama el front solo, no una persona. Va holgado para no cortar
   * a una oficina entera detrás de una sola IP, pero acotado igual: sin límite,
   * es un oráculo para adivinar tokens.
   */
  RATE_LIMIT_REFRESH_IP: z.coerce.number().int().positive().default(60),

  /**
   * El techo de uso normal de la app, por usuario y por minuto.
   *
   * No protege contraseñas —de eso se ocupan los contadores de `/auth`— sino
   * del token robado que se usa para bajarse la base entera a máquina. 300 por
   * minuto es holgado para una persona: una pantalla pesada dispara unos veinte
   * requests y nadie abre quince por minuto sostenidamente.
   */
  RATE_LIMIT_GENERAL: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_GENERAL_VENTANA_MIN: z.coerce.number().int().positive().default(1),

  /**
   * Las llamadas a un tercero, por inmobiliaria y por minuto.
   *
   * El caso es la Central de Deudores del BCRA: nos limita a NOSOTROS, por la
   * IP del servidor, así que la cuota es una sola y la comparten todas las
   * inmobiliarias del despliegue. Sin un tope por inmobiliaria, una que
   * consulte en lote deja a las demás sin poder verificar un garante —y el
   * error que ven no es suyo ni lo pueden resolver—.
   */
  RATE_LIMIT_TERCEROS: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_TERCEROS_VENTANA_MIN: z.coerce.number().int().positive().default(1),

  /**
   * Cuántos años se guarda el legajo de un garante después de que TERMINÓ el
   * contrato que garantizaba.
   *
   * Cinco por defecto. No es un número que traiga la Ley 25.326 —no fija
   * plazos: fija el principio de que el dato no se guarda más allá de su
   * finalidad—, sino el horizonte en el que un contrato de alquiler todavía
   * puede discutirse. **Es una decisión de la inmobiliaria y de su abogado**, y
   * por eso es una variable y no una constante escondida en el código.
   */
  RETENCION_LEGAJOS_ANIOS: z.coerce.number().int().positive().default(5),

  /**
   * Cuántos meses se guarda el DESGLOSE crudo de la consulta al BCRA.
   *
   * El veredicto —apto, motivo, situación, período— no vence nunca: es la
   * memoria de cálculo de una decisión que hay que poder explicar. Lo que vence
   * es el detalle banco por banco de la deuda de un tercero, que después de un
   * año no explica nada que el veredicto no diga y sigue siendo dato bancario
   * de alguien que ni siquiera es cliente nuestro.
   */
  RETENCION_BCRA_MESES: z.coerce.number().int().positive().default(12),

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
  'MIGRATE_ON_BOOT' | 'SEED_ON_BOOT' | 'COOKIE_SECURE' | 'LOG_JSON'
  | 'RATE_LIMIT_EN_BASE' | 'SINCRONIZAR_INDICES'
> & {
  MIGRATE_ON_BOOT: boolean;
  SEED_ON_BOOT: boolean;
  SINCRONIZAR_INDICES: boolean;
  COOKIE_SECURE: boolean;
  LOG_JSON: boolean;
  RATE_LIMIT_EN_BASE: boolean;
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
    SINCRONIZAR_INDICES: e.SINCRONIZAR_INDICES === 'true',
    COOKIE_SECURE: e.COOKIE_SECURE === 'true',
    // Sin valor explícito, sigue al entorno.
    LOG_JSON: e.LOG_JSON ? e.LOG_JSON === 'true' : e.NODE_ENV === 'production',
    RATE_LIMIT_EN_BASE: e.RATE_LIMIT_EN_BASE
      ? e.RATE_LIMIT_EN_BASE === 'true'
      : e.NODE_ENV === 'production',
    isProduction: e.NODE_ENV === 'production',
  };

  // Una rotación mal hecha: el mismo valor en los dos lados no rota nada y deja
  // creyendo que sí. Se corta en cualquier entorno, porque el error es el
  // mismo en dev que en producción.
  if (cached.JWT_SECRET_ANTERIOR && cached.JWT_SECRET_ANTERIOR === cached.JWT_SECRET) {
    throw new Error(
      'JWT_SECRET_ANTERIOR es igual a JWT_SECRET: eso no rota nada. ' +
        'Poné el secreto viejo, o sacá la variable si la rotación ya terminó.',
    );
  }

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
