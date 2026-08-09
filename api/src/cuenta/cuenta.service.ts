import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import {
  DESCRIPCION_TIPO, ETIQUETA_TIPO, MODULOS, TIPOS,
  estadoDeModulos, modulosActivos,
  type EstadoModulo, type TipoCuenta,
} from './modulos.motor';

/**
 * Qué clase de cuenta es esta y qué módulos ve.
 *
 * La regla vive en `modulos.motor.ts`, que es puro. Acá está sólo lo que la
 * regla necesita de la base —el tipo, las excepciones y el plan— y lo que
 * escribe cuando alguien mueve un interruptor.
 */

export interface Cuenta {
  tipo: TipoCuenta;
  tipoTexto: string;
  tipoDetalle: string;
  /** Las claves activas. Es lo que el front usa para armar el menú. */
  activos: string[];
  modulos: EstadoModulo[];
  /** Los dos tipos con su descripción, para la pantalla que deja cambiarlo. */
  tipos: Array<{ clave: TipoCuenta; nombre: string; detalle: string }>;
}

@Injectable()
export class CuentaService {
  constructor(private readonly db: DbService) {}

  async leer(tenantId: string): Promise<Cuenta> {
    return this.db.withTenant(tenantId, (ej) => leerCuenta(ej, tenantId));
  }

  /**
   * Cambia el tipo de cuenta.
   *
   * **Cambiar de tipo NO borra las excepciones**: alguien que era gestor, prendió
   * Ventas a mano y ahora pasa a inmobiliaria, sigue con Ventas —ahora por su
   * tipo— y si mañana vuelve a gestor lo conserva, porque lo había pedido
   * explícitamente. Limpiar las excepciones al cambiar de tipo haría que una
   * decisión del usuario se evapore por un cambio de otra cosa.
   */
  async cambiarTipo(tenantId: string, tipo: TipoCuenta): Promise<Cuenta> {
    if (!TIPOS.includes(tipo)) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        `«${tipo}» no es un tipo de cuenta. Los tipos son: ${TIPOS.join(', ')}.`,
        'Unprocessable Entity',
      );
    }

    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        'UPDATE tenant SET tipo = $2 WHERE id = $1',
        [tenantId, tipo],
      );
      if (!rowCount) throw AppError.notFound('No se encontró la inmobiliaria.');
      return leerCuenta(ej, tenantId);
    });
  }

  /**
   * Prende o apaga un módulo.
   *
   * Se guarda como excepción contra lo que trae el tipo, no como lista: si el
   * módulo ya está como se pide por el tipo, la excepción se borra en vez de
   * escribirse. Así una cuenta que nunca tocó nada tiene los dos arrays vacíos y
   * hereda todo lo que el producto agregue después.
   */
  async cambiarModulo(tenantId: string, clave: string, activo: boolean): Promise<Cuenta> {
    if (!MODULOS.some((m) => m.clave === clave)) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        `«${clave}» no es un módulo que se pueda prender o apagar.`,
        'Unprocessable Entity',
      );
    }

    return this.db.withTenant(tenantId, async (ej) => {
      const antes = await leerCuenta(ej, tenantId);
      const modulo = antes.modulos.find((m) => m.clave === clave)!;

      if (modulo.motivo === 'fuera-del-plan') {
        throw new AppError(
          422, ErrorCode.MODULO_NO_INCLUIDO,
          `${modulo.nombre} no está incluido en tu plan. Se prende cambiando de plan, ` +
            'no desde acá.',
          'Unprocessable Entity',
        );
      }

      // El estado que el TIPO da por defecto. Si lo pedido coincide, no hace
      // falta guardar ninguna excepción: se limpian las dos listas.
      const porTipo = modulosActivos(antes.tipo).includes(clave);

      await ej.query(
        `UPDATE tenant SET
           modulos_on  = CASE WHEN $3 AND NOT $4
                              THEN array(SELECT DISTINCT unnest(modulos_on  || $2::text))
                              ELSE array_remove(modulos_on,  $2) END,
           modulos_off = CASE WHEN NOT $3 AND $4
                              THEN array(SELECT DISTINCT unnest(modulos_off || $2::text))
                              ELSE array_remove(modulos_off, $2) END
         WHERE id = $1`,
        [tenantId, clave, activo, porTipo],
      );

      return leerCuenta(ej, tenantId);
    });
  }
}

/**
 * Se exporta suelta porque la usa `auth.service` para meter los módulos en la
 * sesión: el menú tiene que estar bien en el PRIMER render, no después de un
 * request extra que además parpadearía mostrando entradas que no van.
 */
export async function leerCuenta(ej: Ejecutor, tenantId: string): Promise<Cuenta> {
  const { rows } = await ej.query<{
    tipo: TipoCuenta;
    modulos_on: string[];
    modulos_off: string[];
    plan_modulos: string[] | null;
  }>(
    `SELECT t.tipo, t.modulos_on, t.modulos_off, p.modulos AS plan_modulos
       FROM tenant t
       LEFT JOIN suscripcion s ON s.tenant_id = t.id
       LEFT JOIN plan p ON p.codigo = s.plan_codigo
      WHERE t.id = $1`,
    [tenantId],
  );
  if (!rows.length) throw AppError.notFound('No se encontró la inmobiliaria.');

  const r = rows[0];
  const modulos = estadoDeModulos(r.tipo, r.modulos_on, r.modulos_off, r.plan_modulos);

  return {
    tipo: r.tipo,
    tipoTexto: ETIQUETA_TIPO[r.tipo],
    tipoDetalle: DESCRIPCION_TIPO[r.tipo],
    activos: modulos.filter((m) => m.activo).map((m) => m.clave),
    modulos,
    tipos: TIPOS.map((t) => ({
      clave: t,
      nombre: ETIQUETA_TIPO[t],
      detalle: DESCRIPCION_TIPO[t],
    })),
  };
}
