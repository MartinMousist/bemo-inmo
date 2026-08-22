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
  /**
   * El plan, para la barra de arriba. `null` si la cuenta no tiene suscripción
   * cargada — que es un problema de datos nuestro y no puede romper la barra.
   */
  plan: {
    codigo: string;
    nombre: string | null;
    familia: string | null;
    estado: string | null;
    /** La única fecha real que existe: el fin de la prueba. */
    pruebaHasta: string | null;
    /** Días que faltan, contados por Postgres. Negativo = ya venció. */
    diasDePrueba: number | null;
  } | null;
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
    plan_codigo: string | null;
    plan_nombre: string | null;
    plan_familia: string | null;
    suscripcion_estado: string | null;
    prueba_hasta: string | null;
    dias_de_prueba: number | null;
  }>(
    `SELECT t.tipo, t.modulos_on, t.modulos_off, p.modulos AS plan_modulos,
            p.codigo AS plan_codigo, p.nombre AS plan_nombre, p.familia AS plan_familia,
            s.estado AS suscripcion_estado, s.prueba_hasta,
            -- Los días los cuenta POSTGRES y no el navegador: la fecha de la
            -- máquina de quien mira puede estar corrida, y «te quedan 3 días»
            -- es justo el número donde eso se nota.
            (s.prueba_hasta - current_date) AS dias_de_prueba
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
    /**
     * El plan, para la barra de arriba.
     *
     * Viaja acá y no en un pedido aparte porque la barra está en TODAS las
     * pantallas: una llamada más por carga, para dibujar dos palabras, se paga
     * en cada navegación.
     *
     * ⚠️ `diasDePrueba` sale de `prueba_hasta`, que es la ÚNICA fecha real que
     * existe. No hay «vence el» de un plan pago porque no hay cobro integrado:
     * `suscripcion` no tiene una fecha de renovación. Mostrar una sería
     * inventar el dato más delicado de la pantalla.
     */
    plan: r.plan_codigo
      ? {
          codigo: r.plan_codigo,
          nombre: r.plan_nombre,
          familia: r.plan_familia,
          estado: r.suscripcion_estado,
          pruebaHasta: r.prueba_hasta,
          diasDePrueba: r.dias_de_prueba,
        }
      : null,
    tipos: TIPOS.map((t) => ({
      clave: t,
      nombre: ETIQUETA_TIPO[t],
      detalle: DESCRIPCION_TIPO[t],
    })),
  };
}
