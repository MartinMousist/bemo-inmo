import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { normalizar, numeroFlexible, parsearCsv } from '../importar/csv.parser';

/**
 * Cargar las unidades de un emprendimiento desde una planilla.
 *
 * ── Por qué CSV y no `.xlsx` ──
 *
 * Porque Excel exporta CSV con «Guardar como» y leer `.xlsx` de verdad es una
 * dependencia más en la cadena de suministro —la parte que la etapa 17.3 fue a
 * mirar— para resolver un paso que el usuario ya sabe hacer. El parser que ya
 * existe se come el BOM que escribe Excel, detecta el separador (`;` en las
 * configuraciones en español) y tolera «1.250,50» además de «1250.50».
 *
 * ── Simular antes de escribir ──
 *
 * `simular: true` procesa todo y no guarda nada. Es obligatorio en la pantalla
 * antes de confirmar: una planilla de 40 unidades con la columna corrida crea 40
 * propiedades mal cargadas, y deshacer eso es peor que cargarlas a mano.
 */

export interface FilaImportada {
  linea: number;
  piso: string | null;
  depto: string | null;
  tipologia: string | null;
  ambientes: number | null;
  supTotal: number | null;
  coeficiente: number | null;
  precio: number | null;
  problema: string | null;
}

export interface ResultadoImportacion {
  simulado: boolean;
  total: number;
  aceptadas: number;
  rechazadas: number;
  filas: FilaImportada[];
  /** Suma de coeficientes. Tiene que dar ~100 si están todas las unidades. */
  sumaCoeficientes: number | null;
}

/** Los nombres que puede tener cada columna, normalizados. */
const COLUMNAS: Record<string, string[]> = {
  piso: ['piso', 'nivel'],
  depto: ['depto', 'departamento', 'unidad', 'ud'],
  tipologia: ['tipologia', 'tipo', 'prototipo'],
  ambientes: ['ambientes', 'amb'],
  supTotal: ['m2', 'metros', 'superficie', 'sup total', 'sup'],
  coeficiente: ['coeficiente', 'coef', 'porcentual'],
  precio: ['precio', 'valor', 'importe'],
};

@Injectable()
export class ImportarUnidadesService {
  constructor(private readonly db: DbService) {}

  /** La plantilla, con una fila de ejemplo. */
  plantilla(): string {
    return [
      'piso;depto;tipologia;ambientes;m2;coeficiente;precio',
      '1;A;2 amb frente;2;48,50;2,45;89000',
      '1;B;1 amb contrafrente;1;33,00;1,70;62000',
    ].join('\n');
  }

  async importar(
    tenantId: string,
    emprendimientoId: string,
    csv: string,
    opciones: { simular: boolean; moneda: string },
  ): Promise<ResultadoImportacion> {
    const { cabeceras, filas } = parsearCsv(csv);
    // El mapa va de nuestra clave al NOMBRE de la cabecera, no a su posición:
    // `parsearCsv` devuelve cada fila como objeto indexado por cabecera.
    const mapa = mapearColumnas(cabeceras);

    if (mapa.depto === undefined && mapa.tipologia === undefined) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        'La planilla no tiene una columna de departamento ni de tipología: sin '
        + 'alguna de las dos no se puede distinguir una unidad de otra.',
        'Unprocessable Entity',
      );
    }

    const leidas: FilaImportada[] = filas.map((f: Record<string, string>, i) => {
      const val = (k: string) => (mapa[k] === undefined ? null : (f[mapa[k]] ?? '').trim());

      const fila: FilaImportada = {
        // +2: la línea 1 son las cabeceras y la gente cuenta desde 1.
        linea: i + 2,
        piso: val('piso') || null,
        depto: val('depto') || null,
        tipologia: val('tipologia') || null,
        ambientes: numeroFlexible(val('ambientes')),
        supTotal: numeroFlexible(val('supTotal')),
        coeficiente: numeroFlexible(val('coeficiente')),
        precio: numeroFlexible(val('precio')),
        problema: null,
      };

      if (!fila.depto && !fila.tipologia) {
        fila.problema = 'Sin departamento ni tipología: no se sabe qué unidad es.';
      } else if (fila.precio !== null && fila.precio <= 0) {
        fila.problema = 'El precio tiene que ser mayor a cero.';
      } else if (fila.supTotal !== null && fila.supTotal <= 0) {
        fila.problema = 'La superficie tiene que ser mayor a cero.';
      }

      return fila;
    });

    const aceptadas = leidas.filter((f) => !f.problema);

    const coefs = aceptadas.map((f) => f.coeficiente).filter((c): c is number => c !== null);
    const sumaCoeficientes = coefs.length
      ? Math.round(coefs.reduce((a, c) => a + c, 0) * 100) / 100
      : null;

    if (!opciones.simular && aceptadas.length) {
      await this.guardar(tenantId, emprendimientoId, aceptadas, opciones.moneda);
    }

    return {
      simulado: opciones.simular,
      total: leidas.length,
      aceptadas: aceptadas.length,
      rechazadas: leidas.length - aceptadas.length,
      filas: leidas,
      sumaCoeficientes,
    };
  }

  private async guardar(
    tenantId: string,
    emprendimientoId: string,
    filas: FilaImportada[],
    moneda: string,
  ): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rows: emp } = await ej.query<{ calle: string; numero: string | null; localidad: string | null }>(
        'SELECT calle, numero, localidad FROM emprendimiento WHERE id = $1',
        [emprendimientoId],
      );
      if (!emp.length) throw AppError.notFound('No se encontró ese emprendimiento.');
      const e = emp[0];

      for (const f of filas) {
        // La dirección de la unidad es la del emprendimiento: en pozo no tiene
        // una propia, y dejarla vacía rompería los listados que la muestran.
        const { rows } = await ej.query<{ id: string }>(
          `INSERT INTO propiedad
             (tenant_id, codigo, calle, numero, piso, depto, localidad, tipo,
              ambientes, sup_total, tipologia, coeficiente, emprendimiento_id)
           VALUES ($1, app_proximo_codigo_propiedad(), $2,$3,$4,$5,$6,'departamento',
                   $7,$8,$9,$10,$11)
           RETURNING id`,
          [
            tenantId, e.calle, e.numero, f.piso, f.depto, e.localidad,
            f.ambientes, f.supTotal, f.tipologia, f.coeficiente, emprendimientoId,
          ],
        );

        // Con precio se crea también la operación de venta: sin ella la unidad
        // existe pero no está a la venta, y el plano la pintaría como «sin
        // operación» aunque la planilla traía el precio.
        if (f.precio !== null) {
          await ej.query(
            `INSERT INTO operacion (tenant_id, propiedad_id, tipo, precio, moneda, estado)
             VALUES ($1,$2,'venta',$3,$4,'disponible')`,
            [tenantId, rows[0].id, f.precio, moneda],
          );
        }
      }
    });
  }
}

/**
 * De nuestra clave al nombre EXACTO de la cabecera en la planilla.
 *
 * Se compara normalizado de los dos lados —sin acentos, en minúscula, con
 * guiones bajos— para que «Sup. Total», «sup total» y «SUP_TOTAL» sean la misma
 * columna. Lo que se guarda es el nombre original, que es la clave con la que
 * `parsearCsv` indexa cada fila.
 */
function mapearColumnas(cabeceras: string[]): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const c of cabeceras) {
    const n = normalizar(c);
    for (const [clave, alias] of Object.entries(COLUMNAS)) {
      if (mapa[clave] === undefined && alias.some((a) => normalizar(a) === n)) {
        mapa[clave] = c;
      }
    }
  }
  return mapa;
}

export type { Ejecutor };
