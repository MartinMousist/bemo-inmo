import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import { ordenSeguro } from '../common/orden';
import type { ListarPropietariosDto } from './personas.dto';

/**
 * La pantalla Propietarios.
 *
 * ── La fila es la PERSONA, con sus unidades adentro ──
 *
 * Al revés que Inquilinos, y por el mismo criterio: la pregunta de esta
 * pantalla es «¿a quién le tengo que pagar y cuánto?», y eso es por persona.
 * Las unidades van en un detalle que se despliega, porque un propietario con
 * seis departamentos no puede ocupar seis filas en la lista de pagos.
 *
 * ── ⚠️ La última liquidación pueden ser DOS ──
 *
 * La unique de `liquidacion` es (tenant, propietario, período, MONEDA). Un
 * propietario con una unidad en pesos y otra en dólares tiene, para el mismo
 * mes, dos liquidaciones. Colapsarlas a un número —o peor, sumarlas— es un
 * monto sin moneda en una pantalla de plata, que es la regla que este repo
 * llama bug directamente. Por eso `ultimasLiquidaciones` y `pendiente` son
 * ARRAYS por moneda, y la pantalla pinta dos líneas cuando hay dos.
 *
 * ── «Sin liquidar hace N meses» es derivado ──
 *
 * Sale de comparar el último período liquidado contra el mes corriente. No hay
 * ni va a haber una columna que alguien marque: un dato derivado no se
 * desincroniza.
 */

export interface MontoPorMoneda {
  moneda: string;
  monto: number;
}

export interface UltimaLiquidacion {
  moneda: string;
  periodo: string;
  estado: string;
  neto: number;
}

export interface FilaPropietario {
  personaId: string;
  nombre: string;
  docNumero: string | null;

  unidades: Array<{
    id: string;
    etiqueta: string;
    direccion: string;
    /** Sólo cuando NO es 100: un «100%» en cada fila es ruido. */
    porcentaje: number | null;
    administrada: boolean;
  }>;
  /** Cuántas de sus unidades tienen contrato administrado vigente. */
  administradas: number;

  /** Una por moneda. Vacío = nunca se le liquidó nada. */
  ultimasLiquidaciones: UltimaLiquidacion[];
  /** Cerradas y no pagadas todavía, por moneda. Esto es lo que se le debe. */
  pendiente: MontoPorMoneda[];
  /**
   * Meses desde el último período liquidado. `null` si nunca hubo ninguna
   * —que no es lo mismo que cero— y por eso la pantalla lo dice distinto.
   */
  mesesSinLiquidar: number | null;

  /** El portal del propietario: hay un acceso vivo, o no lo hay. */
  tieneAcceso: boolean;
}

@Injectable()
export class PropietariosService {
  constructor(private readonly db: DbService) {}

  async listar(
    tenantId: string,
    f: ListarPropietariosDto,
  ): Promise<Pagina<FilaPropietario>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      const params = [q, f.soloConPendiente === true];

      const { rows: conteo } = await ej.query<{ total: string }>(
        `${BASE} SELECT count(*)::text AS total ${DESDE} ${DONDE}`,
        params,
      );

      // Por defecto, la lista de a quién hay que pagarle: lo pendiente primero.
      // Se ordena por el total pendiente CONVERTIDO A NADA —o sea, por la suma
      // cruda de las monedas— y eso sería un monto sin moneda si se mostrara.
      // No se muestra: es sólo el criterio de orden, y ordenar por «cuánto debo
      // en total» sin cotización es lo mejor que se puede hacer sin inventar un
      // tipo de cambio. Los importes de la fila van cada uno con su moneda.
      const orden = ordenSeguro(
        {
          propietario: 'p.apellido',
          unidades: 'unidades',
          pendiente: 'pendiente_orden',
          liquidacion: 'ultimo_periodo',
        },
        'pendiente_orden DESC NULLS LAST, p.apellido NULLS LAST, p.nombre',
        f.orden,
        f.dir,
      );

      const { rows } = await ej.query<Fila>(
        `${BASE} ${SELECT} ${DESDE} ${DONDE}
          ORDER BY ${orden}
          LIMIT $3 OFFSET $4`,
        [...params, f.porPagina, offset(f)],
      );

      return armarPagina(rows.map(aFila), Number(conteo[0].total), f);
    });
  }
}

// ── SQL ─────────────────────────────────────────────────────────────────────

/**
 * Las liquidaciones agregadas por propietario Y POR MONEDA.
 *
 * `DISTINCT ON (propietario_id, moneda)` y no `(propietario_id)`: sacar la
 * moneda del DISTINCT devuelve una sola fila por propietario y hace desaparecer
 * la liquidación en dólares sin decir nada. Es el error que la unique de la
 * tabla está anunciando desde la etapa 4.
 */
const BASE = `
WITH ultima_liq AS (
  SELECT DISTINCT ON (propietario_id, moneda)
         propietario_id, moneda, periodo, estado, total_neto
    FROM liquidacion
   ORDER BY propietario_id, moneda, periodo DESC
),
pendiente_liq AS (
  -- Cerrada = el número está firme y todavía no salió la plata. Una en
  -- borrador NO se debe: se está armando y sus montos pueden cambiar.
  SELECT propietario_id, moneda, sum(total_neto) AS monto
    FROM liquidacion
   WHERE estado = 'cerrada'
   GROUP BY propietario_id, moneda
)`;

const SELECT = `
  SELECT p.id, p.nombre, p.apellido, p.doc_numero,

         (SELECT json_agg(json_build_object(
                   'id', pr.id, 'codigo', pr.codigo,
                   'direccion', trim(pr.calle || ' ' || coalesce(pr.numero, '')),
                   'porcentaje', t2.porcentaje,
                   'administrada', EXISTS (
                     SELECT 1 FROM contrato_alquiler c
                      WHERE c.propiedad_id = pr.id AND c.administrado
                        AND c.estado IN ('vigente', 'por_iniciar')))
                 ORDER BY pr.codigo)
            FROM titularidad t2 JOIN propiedad pr ON pr.id = t2.propiedad_id
           WHERE t2.persona_id = p.id) AS unidades,

         (SELECT count(*)::int FROM titularidad t3
            JOIN contrato_alquiler c ON c.propiedad_id = t3.propiedad_id
           WHERE t3.persona_id = p.id AND c.administrado
             AND c.estado IN ('vigente', 'por_iniciar')) AS administradas,

         (SELECT json_agg(json_build_object(
                   'moneda', u.moneda, 'periodo', u.periodo,
                   'estado', u.estado, 'neto', u.total_neto) ORDER BY u.moneda)
            FROM ultima_liq u WHERE u.propietario_id = p.id) AS ultimas,

         (SELECT json_agg(json_build_object('moneda', pl.moneda, 'monto', pl.monto)
                          ORDER BY pl.moneda)
            FROM pendiente_liq pl WHERE pl.propietario_id = p.id) AS pendiente,

         -- Sólo para ordenar. Suma monedas distintas a propósito y NO se
         -- devuelve: ver el comentario del ORDER BY.
         (SELECT sum(pl.monto) FROM pendiente_liq pl
           WHERE pl.propietario_id = p.id) AS pendiente_orden,

         (SELECT max(u.periodo) FROM ultima_liq u
           WHERE u.propietario_id = p.id) AS ultimo_periodo,

         -- Los meses de calendario desde el último período liquidado, contados
         -- CON LA FECHA DE LA BASE.
         --
         -- Estaba en TypeScript con un new Date() del proceso, y el proceso
         -- corre en UTC: entre las 21 y las 24 de Argentina del último día del
         -- mes, para Node ya es el mes siguiente y la fila decía «sin liquidar
         -- hace 2 meses» donde hacía 1. Es el mismo error de huso que la regla
         -- de no pasar una columna date por new Date(), sólo que del lado del
         -- «hoy»: current_date es el mismo día con el que se calcula todo lo
         -- demás de esta pantalla.
         --
         -- (Sin comillas invertidas adentro de un SQL embebido: una sola cierra
         --  el template literal y tsc tira TS1005 en la línea de abajo. Trampa
         --  ya anotada en inquilinos.service.ts y en propiedades.service.ts —y
         --  en la que este mismo comentario cayó al escribirse.)
         (SELECT ((date_part('year', current_date) - date_part('year', max(u.periodo))) * 12
                + (date_part('month', current_date) - date_part('month', max(u.periodo))))::int
            FROM ultima_liq u WHERE u.propietario_id = p.id) AS meses_sin_liquidar,

         (SELECT count(*)::int FROM titularidad t4 WHERE t4.persona_id = p.id) AS unidades_n,

         EXISTS (SELECT 1 FROM acceso_portal ap
                  WHERE ap.persona_id = p.id AND ap.revocado_el IS NULL
                    AND ap.expira_el > now()) AS tiene_acceso`;

const DESDE = `FROM persona p`;

/**
 * Propietario = tiene al menos una titularidad. Es el MISMO conjunto que el rol
 * derivado `propietario` de `personas.service.ts` (`CONJUNTO_ROL.propietario`),
 * y tiene que seguir siéndolo: si esta pantalla usara otro criterio, la pestaña
 * «Propietarios 18» y esta lista mostrarían números distintos.
 */
const DONDE = `
  WHERE EXISTS (SELECT 1 FROM titularidad t WHERE t.persona_id = p.id)
    AND ($1::text IS NULL
         OR (coalesce(p.nombre,'') || ' ' || coalesce(p.apellido,'')) ILIKE $1
         OR p.doc_numero ILIKE $1)
    AND (NOT $2::boolean
         OR EXISTS (SELECT 1 FROM liquidacion l
                     WHERE l.propietario_id = p.id AND l.estado = 'cerrada'))`;

interface Fila {
  id: string; nombre: string; apellido: string | null; doc_numero: string | null;
  unidades: Array<{
    id: string; codigo: number; direccion: string;
    porcentaje: string | null; administrada: boolean;
  }> | null;
  administradas: number;
  ultimas: Array<{ moneda: string; periodo: string; estado: string; neto: string }> | null;
  pendiente: Array<{ moneda: string; monto: string }> | null;
  ultimo_periodo: string | null;
  meses_sin_liquidar: number | null;
  unidades_n: number;
  tiene_acceso: boolean;
}

function aFila(f: Fila): FilaPropietario {
  return {
    personaId: f.id,
    nombre: [f.nombre, f.apellido].filter(Boolean).join(' '),
    docNumero: f.doc_numero,

    unidades: (f.unidades ?? []).map((u) => ({
      id: u.id,
      etiqueta: `PROP-${String(u.codigo).padStart(4, '0')}`,
      direccion: u.direccion,
      // 100% no se muestra: es el caso normal y repetirlo en cada unidad tapa
      // el 50% que sí importa.
      porcentaje: u.porcentaje === null || Number(u.porcentaje) === 100
        ? null
        : Number(u.porcentaje),
      administrada: u.administrada,
    })),
    administradas: Number(f.administradas),

    ultimasLiquidaciones: (f.ultimas ?? []).map((u) => ({
      moneda: u.moneda,
      // `periodo` es una columna `date`: se recorta como texto. Ver la trampa
      // de las columnas `date` en docs/CONTINUAR.md §4.
      periodo: String(u.periodo).slice(0, 10),
      estado: u.estado,
      neto: Number(u.neto),
    })),
    pendiente: (f.pendiente ?? []).map((p) => ({
      moneda: p.moneda,
      monto: Number(p.monto),
    })),
    // Lo cuenta la base con `current_date`. Ver el comentario de la columna:
    // hacerlo acá con `new Date()` sumaba un mes de más las últimas tres horas
    // del último día del mes, porque el proceso corre en UTC y el país no.
    mesesSinLiquidar: f.meses_sin_liquidar === null ? null : Number(f.meses_sin_liquidar),

    tieneAcceso: f.tiene_acceso,
  };
}

