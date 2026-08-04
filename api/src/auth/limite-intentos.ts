import { Injectable, type ExecutionContext } from '@nestjs/common';
import {
  SkipThrottle,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { AppError, ErrorCode } from '../common/app-error';
import { loadEnv } from '../config/env';

/**
 * Límite de intentos en las rutas públicas de `/auth`.
 *
 * Dos contadores con nombre, que corren a la vez sobre cada request:
 *
 * | Contador | Se cuenta por | Qué ataque frena |
 * |---|---|---|
 * | `ip`     | la IP de origen | muchas contraseñas desde un solo lugar |
 * | `cuenta` | el email del cuerpo | el mismo ataque repartido entre muchas IPs |
 *
 * El de cuenta va con el tope MÁS ALTO a propósito. Un tope bajo por cuenta es un
 * arma: cualquiera puede dejar a un usuario real afuera quemándole los intentos.
 * Con el tope alto sólo se activa contra un ataque sostenido, que es lo que la IP
 * sola no ve.
 *
 * Se cuentan **todos** los intentos, no sólo los fallidos: el guard corre antes
 * del handler y no sabe todavía si la contraseña era buena. Con 10 por ventana no
 * molesta a nadie — una sesión dura 14 días y se renueva sola.
 *
 * ⚠️ El almacenamiento por defecto es **en memoria del proceso**. Con una sola
 * instancia alcanza; el día que haya dos réplicas detrás de un balanceador, cada
 * una lleva su propio contador y el límite efectivo se duplica. Ahí hay que
 * enchufar un storage compartido (Redis) — está anotado en el roadmap.
 */

export const POR_IP = 'ip';
export const POR_CUENTA = 'cuenta';

const enMs = (minutos: number) => minutos * 60_000;

/**
 * Los topes se resuelven **en cada request**, no al construir el módulo. Es lo
 * que permite que los tests los muevan sin levantar otro proceso, y que en
 * producción se ajusten con una variable de entorno y un reinicio.
 */
export const opcionesDeLimite: ThrottlerModuleOptions = {
  throttlers: [
    {
      name: POR_IP,
      ttl: () => enMs(loadEnv().RATE_LIMIT_VENTANA_MIN),
      limit: () => loadEnv().RATE_LIMIT_LOGIN_IP,
      getTracker: (req) => `ip:${req.ip ?? 'desconocida'}`,
    },
    {
      name: POR_CUENTA,
      ttl: () => enMs(loadEnv().RATE_LIMIT_VENTANA_MIN),
      limit: () => loadEnv().RATE_LIMIT_LOGIN_CUENTA,
      getTracker: (req) => trackerDeCuenta(req),
    },
  ],
};

/**
 * Normaliza el email antes de contar. Sin esto `Ana@X.com` y `ana@x.com` son dos
 * contadores distintos y el límite por cuenta no cuenta nada.
 */
function trackerDeCuenta(req: Record<string, unknown>): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  // Sin email en el cuerpo no hay cuenta que proteger: se cae a la IP para que el
  // contador siga existiendo en vez de compartir una clave vacía entre todos.
  return email ? `cuenta:${email}` : `ip:${(req as { ip?: string }).ip ?? 'desconocida'}`;
}

/**
 * Saca la ruta de TODOS los contadores.
 *
 * Existe porque `@SkipThrottle()` sin argumentos salta el contador llamado
 * `default`, y acá los contadores se llaman `ip` y `cuenta`: el decorador pelado
 * no salta nada y la ruta queda limitada igual, en silencio. Lo encontró el test
 * de `logout`, y habría sido un bug de producción en `/auth/yo` — que el front
 * llama en cada carga de página.
 */
export const SinLimite = () => SkipThrottle({ [POR_IP]: true, [POR_CUENTA]: true });

@Injectable()
export class LimiteIntentosGuard extends ThrottlerGuard {
  /**
   * El 429 tiene que salir con la MISMA forma que el resto de los errores
   * (RFC 9457, con `code`). La excepción propia de la librería sale como un
   * `HttpException` genérico y el front no la puede distinguir de un 429 de un
   * proxy.
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    detalle: ThrottlerLimitDetail,
  ): Promise<void> {
    const segundos = Math.max(1, Math.ceil(detalle.timeToBlockExpire));
    const { res } = this.getRequestResponse(context);
    // La librería pone `Retry-After-ip` / `Retry-After-cuenta` porque los
    // contadores tienen nombre. El header que un cliente entiende es el pelado.
    res.header?.('Retry-After', String(segundos));

    throw new AppError(
      429,
      ErrorCode.DEMASIADOS_INTENTOS,
      `Demasiados intentos. Probá de nuevo en ${enPalabras(segundos)}.`,
      'Too Many Requests',
    );
  }
}

function enPalabras(segundos: number): string {
  if (segundos < 60) return `${segundos} segundos`;
  const minutos = Math.ceil(segundos / 60);
  return minutos === 1 ? 'un minuto' : `${minutos} minutos`;
}
