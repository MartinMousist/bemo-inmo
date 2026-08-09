import { Injectable } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import { ordenSeguro } from '../common/orden';
import { BASE, COBRANZA, type EstadoCobranza } from '../alquileres/cartera.service';
import { MINIMO_GARANTES } from '../garantes/garantes.service';
import type { ListarInquilinosDto } from './personas.dto';

/**
 * La pantalla Inquilinos.
 *
 * ── La fila es el CONTRATO, no la persona ──
 *
 * Una persona puede alquilar dos unidades a la vez —o alquilar una, mudarse y
 * alquilar otra— y una fila por persona esconde uno de los dos contratos. Y lo
 * esconde de la peor manera: la fila muestra un alquiler, un vencimiento y una
 * deuda que son de uno solo de los contratos, sin decir cuál.
 *
 * ── Por qué este número NO coincide con la pestaña «Inquilinos» de Personas ──
 *
 * La pestaña cuenta PERSONAS que fueron locatarias alguna vez —haber alquilado
 * es un hecho, no una situación—. Esta pantalla lista CONTRATOS y arranca
 * filtrada en los vigentes. Que diga «17 personas alquilaron» y acá se vean 12
 * contratos es correcto y parece un bug, así que la bajada de la pantalla dice
 * las dos cifras. Es la primera pregunta que va a hacer quien mire esto.
 *
 * ── La mora no se reimplementa ──
 *
 * `BASE` y `COBRANZA` vienen de `alquileres/cartera.service.ts`, donde ya viven
 * el cálculo de al_dia / parcial / en_mora / sin_cuotas, el adeudado y la fecha
 * de la cuota impaga más vieja. Son importados y no copiados a propósito: la
 * regla de que «la mora gana sobre lo parcial» tiene que poder cambiar en un
 * solo lugar.
 */

export interface FilaInquilino {
  contratoId: string;
  inquilino: { id: string; nombre: string } | null;
  /** Los demás locatarios del mismo contrato, cuando firman dos. */
  coInquilinos: string[];
  propiedad: { id: string; etiqueta: string; direccion: string };

  desde: string;
  hasta: string;
  estado: string;
  vigente: boolean;

  /** El alquiler de HOY. Ver el comentario del SQL: no es `monto_inicial`. */
  alquilerVigente: number;
  moneda: string;

  cobranza: EstadoCobranza;
  /**
   * Saldo impago del contrato, en su moneda. **No es «adeudado»**: incluye la
   * cuota del mes que todavía no venció, así que un contrato «Al día» puede
   * mostrar un saldo. Se llamaba `adeudado` y se vio en la app —«Al día» con
   * ARS 712.000 al lado, que era la cuota que vencía al día siguiente—. Es el
   * mismo número que la ficha del contrato muestra en la columna Saldo.
   */
  saldo: number;
  /** Días desde el vencimiento de la cuota impaga más vieja. 0 si no debe. */
  diasDeMora: number;
  moraDesde: string | null;

  proximoAjuste: { vigenteDesde: string; estado: string } | null;

  garantes: { cargados: number; minimo: number };
}

@Injectable()
export class InquilinosService {
  constructor(private readonly db: DbService) {}

  async listar(
    tenantId: string,
    f: ListarInquilinosDto,
  ): Promise<Pagina<FilaInquilino> & { personasQueAlquilaron: number }> {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      // `vigentes` es el default y no «todos»: la pregunta de todos los días es
      // «¿quién vive hoy en mis unidades y cómo viene pagando?». Un contrato
      // rescindido en 2023 no tiene nada que hacer arriba de esa lista.
      //
      // `por_iniciar` entra junto con `vigente`: es un contrato firmado cuya
      // llave todavía no se entregó, y quien lo firmó ya es el inquilino de esa
      // unidad. Dejarlo afuera esconde justo el que hay que preparar.
      const soloVigentes = f.vigencia !== 'todos';
      const params = [q, f.cobranza ?? null, soloVigentes];

      const { rows: conteo } = await ej.query<{ total: string }>(
        `${BASE} SELECT count(*)::text AS total ${DESDE} ${DONDE}`,
        params,
      );

      // El orden por defecto es la lista de a quién hay que llamar: primero los
      // que deben, y entre ellos el que hace más que debe. Ordenar por fecha de
      // firma pondría arriba lo que no requiere nada.
      const orden = ordenSeguro(
        {
          inquilino: 'inquilino',
          propiedad: 'pr.codigo',
          alquiler: 'monto_vigente',
          saldo: 'adeudado',
          mora: 'dias_de_mora',
          vence: 'c.fecha_fin',
        },
        '(coalesce(r.en_mora, 0) > 0) DESC, dias_de_mora DESC, c.fecha_fin',
        f.orden,
        f.dir,
      );

      const { rows } = await ej.query<Fila>(
        `${BASE} ${SELECT} ${DESDE} ${DONDE}
          ORDER BY ${orden}
          LIMIT $4 OFFSET $5`,
        [...params, f.porPagina, offset(f)],
      );

      // El otro número de la bajada. Es el MISMO conjunto que la pestaña
      // «Inquilinos» de Personas —`contrato_parte` con rol locatario, sin mirar
      // el estado del contrato— y se pide acá para que la pantalla pueda
      // explicar la diferencia en vez de dejar que parezca un bug.
      const { rows: personas } = await ej.query<{ n: string }>(
        `SELECT count(DISTINCT persona_id)::text AS n
           FROM contrato_parte WHERE rol = 'locatario'`,
      );

      return {
        ...armarPagina(rows.map(aFila), Number(conteo[0].total), f),
        personasQueAlquilaron: Number(personas[0].n),
      };
    });
  }
}

// ── SQL ─────────────────────────────────────────────────────────────────────
//
// Igual que en cartera: el conteo y la página comparten FROM y WHERE, porque
// duplicarlos es lo que hace que el paginador diga 40 y la tabla muestre 12.

const SELECT = `
  SELECT c.id, c.moneda, c.fecha_inicio, c.fecha_fin, c.estado,
         c.estado IN ('vigente', 'por_iniciar') AS vigente,

         pr.id AS propiedad_id, pr.codigo AS propiedad_codigo,
         trim(pr.calle || ' ' || coalesce(pr.numero, '')) AS direccion,

         -- El alquiler de HOY: el último ajuste que ya rige, o el inicial si
         -- todavía no hubo ninguno. NO existe una columna monto_vigente —es
         -- este coalesce, y sale de SELECT_CONTRATO—: usar monto_inicial en su
         -- lugar no falla, muestra un alquiler viejo, que es peor.
         --
         -- (Los nombres de columna van sin comillas invertidas adentro de un
         -- SQL embebido: una sola cierra el template literal y tsc tira
         -- «TS1005: ',' expected» en la línea de ABAJO. Trampa ya anotada.)
         coalesce(
           (SELECT a.monto_nuevo FROM contrato_ajuste a
             WHERE a.contrato_id = c.id
               AND a.estado IN ('confirmado','notificado','aplicado')
               AND a.vigente_desde <= current_date
             ORDER BY a.vigente_desde DESC LIMIT 1),
           c.monto_inicial) AS monto_vigente,

         inq.persona_id AS inquilino_id,
         inq.nombre AS inquilino,
         -- Los demás locatarios del contrato. Un alquiler firmado por una
         -- pareja tiene dos, y mostrar uno solo hace que quien atiende el
         -- teléfono no reconozca al que llama.
         (SELECT array_agg(trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,''))
                           ORDER BY pe.apellido, pe.nombre)
            FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
           WHERE cp.contrato_id = c.id AND cp.rol = 'locatario'
             AND cp.persona_id <> inq.persona_id) AS co_inquilinos,

         coalesce(r.adeudado, 0) AS adeudado,
         -- Días desde la cuota impaga más vieja. current_date de la base y no
         -- del proceso: es el mismo día con el que se calculó en_mora.
         coalesce((current_date - r.mora_desde)::int, 0) AS dias_de_mora,
         r.mora_desde,
         ${COBRANZA} AS cobranza,

         aj.vigente_desde AS aj_desde, aj.estado AS aj_estado,

         (SELECT count(*)::int FROM garantia g WHERE g.contrato_id = c.id) AS garantes`;

/**
 * El inquilino «principal» del contrato, uno por fila.
 *
 * Va como LATERAL y no como subconsulta en el SELECT porque hace falta su `id`
 * para excluirlo de la lista de co-inquilinos, y porque el `ORDER BY inquilino`
 * necesita que sea una columna del FROM.
 *
 * LEFT JOIN: un contrato puede no tener locatario cargado —los importados por
 * CSV nacen así— y con un JOIN a secas desaparecería del listado sin que nadie
 * se entere. Un contrato sin inquilino es exactamente lo que hay que ver.
 */
const DESDE = `
  FROM contrato_alquiler c
  JOIN propiedad pr ON pr.id = c.propiedad_id
  LEFT JOIN LATERAL (
    SELECT cp.persona_id,
           trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) AS nombre
      FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
     WHERE cp.contrato_id = c.id AND cp.rol = 'locatario'
     ORDER BY pe.apellido, pe.nombre LIMIT 1
  ) inq ON true
  LEFT JOIN resumen r ON r.contrato_id = c.id
  LEFT JOIN proximo aj ON aj.contrato_id = c.id`;

const DONDE = `
  WHERE ($1::text IS NULL
         OR inq.nombre ILIKE $1
         OR pr.calle ILIKE $1 OR pr.localidad ILIKE $1
         OR pr.codigo::text = trim(both '%' from $1))
    AND ($2::text IS NULL OR ${COBRANZA} = $2)
    AND (NOT $3::boolean OR c.estado IN ('vigente', 'por_iniciar'))`;

interface Fila {
  id: string; moneda: string; fecha_inicio: string; fecha_fin: string;
  estado: string; vigente: boolean;
  propiedad_id: string; propiedad_codigo: number; direccion: string;
  monto_vigente: string;
  inquilino_id: string | null; inquilino: string | null;
  co_inquilinos: string[] | null;
  adeudado: string; dias_de_mora: number; mora_desde: string | null;
  cobranza: EstadoCobranza;
  aj_desde: string | null; aj_estado: string | null;
  garantes: number;
}

function aFila(f: Fila): FilaInquilino {
  return {
    contratoId: f.id,
    inquilino: f.inquilino_id ? { id: f.inquilino_id, nombre: f.inquilino ?? '' } : null,
    coInquilinos: f.co_inquilinos ?? [],
    propiedad: {
      id: f.propiedad_id,
      etiqueta: `PROP-${String(f.propiedad_codigo).padStart(4, '0')}`,
      direccion: f.direccion,
    },
    // Las columnas `date` viajan como texto y se devuelven como texto. Pasarlas
    // por `new Date()` les inventa medianoche UTC y corre un día: un contrato
    // que empieza el 01/01 se muestra empezando el 31/12.
    desde: String(f.fecha_inicio).slice(0, 10),
    hasta: String(f.fecha_fin).slice(0, 10),
    estado: f.estado,
    vigente: f.vigente,

    alquilerVigente: Number(f.monto_vigente),
    moneda: f.moneda,

    cobranza: f.cobranza,
    saldo: Number(f.adeudado),
    diasDeMora: Number(f.dias_de_mora),
    moraDesde: f.mora_desde ? String(f.mora_desde).slice(0, 10) : null,

    proximoAjuste: f.aj_desde
      ? { vigenteDesde: String(f.aj_desde).slice(0, 10), estado: f.aj_estado! }
      : null,

    garantes: { cargados: Number(f.garantes), minimo: MINIMO_GARANTES },
  };
}
