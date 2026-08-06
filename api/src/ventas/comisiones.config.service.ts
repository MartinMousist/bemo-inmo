import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { round2 } from '../alquileres/ajustes.motor';

/**
 * La política de comisiones de la inmobiliaria.
 *
 * `tenant.comisiones` existía desde la migración 008 con el modelo correcto y
 * **nadie lo leía**: cada venta obligaba a tipear los cuatro porcentajes, y el
 * día que alguien tipeaba 30 donde iba 25 no se enteraba nadie.
 *
 * ── La trampa de unidades, que es la razón por la que estas cuentas dan mal ──
 *
 * El nivel 3 del motor pide el reparto en **% de lo que le queda a la casa**.
 * Una inmobiliaria piensa en **% de la venta**. Con 6% de honorarios:
 *
 *     captador 25% de lo que queda  ≡  1,5% de la venta
 *
 * Se guarda en la unidad del motor y se **muestran las dos**. Guardar «% de la
 * venta» sería peor, y no es obvio por qué: cuando la operación se comparte con
 * otra inmobiliaria, lo que queda se parte al medio, y un captador con 1,5%
 * fijo sobre la venta se llevaría la mitad de lo que entró. Lo que se mantiene
 * es la proporción, no el número.
 */

export interface ConfigComisiones {
  venta: { compradora: number; vendedora: number };
  alquiler: { locataria: number; locadora: number };
  repartoInterno: { captador: number; cerrador: number };
}

/** Lo mismo, con lo que se calcula a partir de eso. Es lo que ve la pantalla. */
export interface ConfigComisionesVista extends ConfigComisiones {
  /** compradora + vendedora. El famoso 6%. */
  totalVenta: number;
  /** Lo que le queda a la casa después del reparto interno, en su misma unidad. */
  casa: number;
  /**
   * Las mismas tres porciones, pero en % de la venta. Valen cuando la operación
   * NO se comparte con otra inmobiliaria: si se comparte, lo que queda se parte
   * y estos números se parten con él. La proporción es la que no cambia.
   */
  sobreLaVenta: { captador: number; cerrador: number; casa: number };
}

const DEFAULTS: ConfigComisiones = {
  venta: { compradora: 3, vendedora: 3 },
  alquiler: { locataria: 0, locadora: 100 },
  repartoInterno: { captador: 25, cerrador: 25 },
};

@Injectable()
export class ComisionesConfigService {
  constructor(private readonly db: DbService) {}

  async leer(tenantId: string): Promise<ConfigComisionesVista> {
    return this.db.withTenant(tenantId, async (ej) => conVista(await leerConfig(ej, tenantId)));
  }

  async guardar(tenantId: string, dto: ConfigComisiones): Promise<ConfigComisionesVista> {
    validar(dto);

    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        'UPDATE tenant SET comisiones = $2 WHERE id = $1',
        [tenantId, JSON.stringify(dto)],
      );
      if (!rowCount) throw AppError.notFound('No se encontró la inmobiliaria.');
      return conVista(dto);
    });
  }
}

/**
 * La config del tenant, completada con los defaults.
 *
 * Se completa campo por campo y no con un spread de primer nivel: un
 * `{...DEFAULTS, ...guardado}` con `{"venta": {"compradora": 4}}` guardado
 * dejaría `venta.vendedora` en `undefined`, y el motor calcularía una punta
 * menos sin decir nada.
 */
export async function leerConfig(ej: Ejecutor, tenantId: string): Promise<ConfigComisiones> {
  const { rows } = await ej.query<{ comisiones: Partial<ConfigComisiones> | null }>(
    'SELECT comisiones FROM tenant WHERE id = $1',
    [tenantId],
  );
  const c = rows[0]?.comisiones ?? {};

  return {
    venta: { ...DEFAULTS.venta, ...(c.venta ?? {}) },
    alquiler: { ...DEFAULTS.alquiler, ...(c.alquiler ?? {}) },
    repartoInterno: { ...DEFAULTS.repartoInterno, ...(c.repartoInterno ?? {}) },
  };
}

export function conVista(c: ConfigComisiones): ConfigComisionesVista {
  const totalVenta = round2(c.venta.compradora + c.venta.vendedora);
  const casa = round2(100 - c.repartoInterno.captador - c.repartoInterno.cerrador);

  return {
    ...c,
    totalVenta,
    casa,
    sobreLaVenta: {
      captador: sobreLaVenta(totalVenta, c.repartoInterno.captador),
      cerrador: sobreLaVenta(totalVenta, c.repartoInterno.cerrador),
      casa: sobreLaVenta(totalVenta, casa),
    },
  };
}

/** `25% de lo que queda` con 6% de honorarios ⇒ `1,5% de la venta`. */
function sobreLaVenta(totalVenta: number, porcentajeInterno: number): number {
  return round4((totalVenta * porcentajeInterno) / 100);
}

/**
 * Las reglas duras. La aritmética del acople —mover una punta y que la otra
 * compense— la hace la pantalla; acá se valida el resultado, porque un PUT
 * también llega desde fuera de la pantalla.
 */
function validar(c: ConfigComisiones): void {
  const numeros = [
    ['venta.compradora', c.venta?.compradora],
    ['venta.vendedora', c.venta?.vendedora],
    ['alquiler.locataria', c.alquiler?.locataria],
    ['alquiler.locadora', c.alquiler?.locadora],
    ['repartoInterno.captador', c.repartoInterno?.captador],
    ['repartoInterno.cerrador', c.repartoInterno?.cerrador],
  ] as const;

  for (const [campo, v] of numeros) {
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 100) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        `${campo} tiene que ser un porcentaje entre 0 y 100.`, 'Unprocessable Entity',
      );
    }
  }

  if (c.venta.compradora + c.venta.vendedora > 100) {
    throw new AppError(
      422, ErrorCode.VALIDATION_FAILED,
      'Las dos puntas de una venta no pueden sumar más del 100% del precio.',
      'Unprocessable Entity',
    );
  }

  // Si el captador y el cerrador suman más de 100, a la casa le queda un número
  // negativo: el motor no emitiría la línea de la casa y el reparto dejaría de
  // cuadrar contra el total. Se corta acá, con un mensaje que dice qué pasa.
  if (c.repartoInterno.captador + c.repartoInterno.cerrador > 100) {
    throw new AppError(
      422, ErrorCode.VALIDATION_FAILED,
      'El captador y el que cierra no pueden llevarse más del 100% de lo que le ' +
        'queda a la inmobiliaria: no quedaría nada para la casa.',
      'Unprocessable Entity',
    );
  }
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e4) / 1e4;
}
