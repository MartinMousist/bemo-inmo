import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { renderizar, variablesDe, type Contexto } from './plantillas.motor';
import { PLANTILLAS_POR_DEFECTO } from './plantillas.defecto';
import {
  aplanarDocumento, textoAHtml, tokensRotos, type TokenRoto,
} from './plantillas.html';
import { sanitizarPlantilla } from './plantillas.sanitizar';

export type FormatoContenido = 'texto' | 'html';

export interface Plantilla {
  id: string;
  tipo: string;
  nombre: string;
  contenido: string;
  /** `html` = editor con formato. `texto` = el textarea de siempre. */
  formato: FormatoContenido;
  activa: boolean;
  variables: string[];
  /**
   * Los `{{ }}` y `{% %}` que el motor NO entiende y que por lo tanto se
   * imprimen literales adentro del contrato. La pantalla los muestra: es la
   * única red contra el peor error de esta feature.
   */
  tokensRotos: TokenRoto[];
  /** Sólo en las convertidas: el texto plano de antes, para poder auditarlo. */
  textoOriginal: string | null;
  convertidaEl: string | null;
}

export interface Documento {
  texto: string;
  /** Igual que en la plantilla: decide `v-html` o `<pre>` en la vista imprimible. */
  formato: FormatoContenido;
  faltantes: string[];
  plantilla: { id: string; nombre: string; tipo: string };
  /** Un problema de la PLANTILLA, no del documento. La UI lo muestra aparte. */
  advertencia?: string;
}

const SELECT_PLANTILLA =
  `SELECT id, tipo, nombre, contenido, contenido_formato, activa,
          contenido_texto_original, convertida_el
     FROM plantilla_doc`;

interface FilaPlantilla {
  id: string;
  tipo: string;
  nombre: string;
  contenido: string;
  contenido_formato: FormatoContenido;
  activa: boolean;
  contenido_texto_original: string | null;
  convertida_el: Date | null;
}

function aPlantilla(r: FilaPlantilla): Plantilla {
  return {
    id: r.id,
    tipo: r.tipo,
    nombre: r.nombre,
    contenido: r.contenido,
    formato: r.contenido_formato,
    activa: r.activa,
    variables: variablesDe(r.contenido),
    tokensRotos: tokensRotos(r.contenido),
    textoOriginal: r.contenido_texto_original,
    convertidaEl: r.convertida_el ? r.convertida_el.toISOString() : null,
  };
}

/**
 * A quién se le puede mandar este documento.
 *
 * Sale del mismo `SELECT` que arma el contexto y no de una consulta aparte: son
 * las partes del contrato, que ya se leyeron. Va SEPARADO del contexto porque no
 * es una variable de plantilla —nadie escribe `{{ destinatarios }}`— sino lo que
 * llena el selector de la pantalla. Antes de esto no había a quién mandarle
 * nada: el contexto traía nombre, documento y domicilio, y ni un teléfono.
 */
export interface Destinatario {
  nombre: string;
  rol: 'locatario' | 'locador' | 'garante';
  telefono: string | null;
  email: string | null;
}

const ETIQUETA_MEDIO: Record<string, string> = {
  efectivo: 'efectivo',
  transferencia: 'transferencia bancaria',
  cheque: 'cheque',
  debito: 'débito',
  otro: 'otro medio',
};

/** Dos decimales, como en toda la plata del sistema. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "marzo de 2026". Se parte a mano: un `date` no pasa por `Date`. */
function periodoLegible(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${MESES[Number(m[2]) - 1]} de ${m[1]}` : iso;
}

@Injectable()
export class PlantillasService {
  constructor(private readonly db: DbService) {}

  /**
   * Sin paginar, a propósito: son las ocho plantillas base más las que la
   * inmobiliaria escriba. Nadie redacta cien modelos de contrato.
   */
  async listar(tenantId: string): Promise<Plantilla[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaPlantilla>(
        `${SELECT_PLANTILLA} ORDER BY tipo, nombre`,
      );
      return rows.map(aPlantilla);
    });
  }

  /**
   * Carga las plantillas base de la inmobiliaria.
   *
   * Son un PUNTO DE PARTIDA, no un modelo legal: cada inmobiliaria las edita
   * con su redacción y su escribanía. Por eso se copian a su cuenta en vez de
   * leerse de una tabla global — si fueran compartidas, editarlas cambiaría el
   * contrato de todas.
   */
  async sembrar(tenantId: string): Promise<{ creadas: number; yaEstaban: number }> {
    return this.db.withTenant(tenantId, async (ej) => {
      // Un SELECT + un INSERT por plantilla eran dos viajes a la base por cada
      // una. Acá el filtro va adentro del INSERT: se insertan de una las que no
      // existen, y las creadas se cuentan por lo que devuelve el RETURNING.
      const { rows: creadas } = await ej.query<{ id: string }>(
        `INSERT INTO plantilla_doc (tenant_id, tipo, nombre, contenido, contenido_formato)
         SELECT $1, x.tipo, x.nombre, x.contenido, 'html'
           FROM unnest($2::text[], $3::text[], $4::text[])
                AS x(tipo, nombre, contenido)
          WHERE NOT EXISTS (
            SELECT 1 FROM plantilla_doc d
             WHERE d.tipo = x.tipo AND d.nombre = x.nombre
          )
         RETURNING id`,
        [
          tenantId,
          PLANTILLAS_POR_DEFECTO.map((p) => p.tipo),
          PLANTILLAS_POR_DEFECTO.map((p) => p.nombre),
          // `plantillas.defecto.ts` sigue en TEXTO PLANO y se convierte acá.
          // Una sola fuente del texto legal, y el conversor queda probado
          // contra las cuatro plantillas reales cada vez que alguien siembra.
          PLANTILLAS_POR_DEFECTO.map((p) => textoAHtml(p.contenido)),
        ],
      );

      return {
        creadas: creadas.length,
        yaEstaban: PLANTILLAS_POR_DEFECTO.length - creadas.length,
      };
    });
  }

  /**
   * Guarda una plantilla. **Es el único punto de escritura**, y por eso es acá
   * donde se sanitiza.
   *
   * No se sanitiza en el editor: `PUT /v1/plantillas` acepta un body y nada
   * obliga a que ese body haya pasado por TipTap. Un `curl` con la sesión de un
   * titular escribe lo que quiera, y lo escrito termina en un `v-html` de la
   * vista imprimible. El editor es comodidad; la frontera es esto.
   *
   * Los avisos del sanitizado se devuelven: si un chip se partió y volvió a ser
   * texto, la persona tiene que enterarse. Arreglarlo en silencio deja una
   * plantilla distinta de la que escribió.
   */
  async guardar(
    tenantId: string,
    dto: {
      id?: string; tipo: string; nombre: string; contenido: string;
      formato?: FormatoContenido;
    },
  ): Promise<Plantilla & { avisos: string[] }> {
    const formato: FormatoContenido = dto.formato ?? 'html';
    const limpio = formato === 'html'
      ? sanitizarPlantilla(dto.contenido)
      // Una plantilla que se guarda como texto plano no lleva HTML: dejarla
      // pasar por el sanitizador le escaparía o le comería etiquetas que en
      // texto plano son texto.
      : { html: dto.contenido, avisos: [] as string[] };

    return this.db.withTenant(tenantId, async (ej) => {
      const id = dto.id
        ? (
            await ej.query<{ id: string }>(
              `UPDATE plantilla_doc
                  SET tipo = $2, nombre = $3, contenido = $4, contenido_formato = $5
                WHERE id = $1 RETURNING id`,
              [dto.id, dto.tipo, dto.nombre, limpio.html, formato],
            )
          ).rows[0]?.id
        : (
            await ej.query<{ id: string }>(
              `INSERT INTO plantilla_doc (tenant_id, tipo, nombre, contenido, contenido_formato)
               VALUES ($1,$2,$3,$4,$5) RETURNING id`,
              [tenantId, dto.tipo, dto.nombre, limpio.html, formato],
            )
          ).rows[0].id;

      if (!id) throw AppError.notFound('No se encontró esa plantilla.');

      const { rows } = await ej.query<FilaPlantilla>(
        `${SELECT_PLANTILLA} WHERE id = $1`, [id],
      );
      return { ...aPlantilla(rows[0]), avisos: limpio.avisos };
    });
  }

  /**
   * Convierte una plantilla de texto plano al editor con formato.
   *
   * Idempotente: una que ya está en HTML se devuelve tal cual, sin tocarla y
   * sin error. Correrla dos veces escaparía las etiquetas de la primera pasada
   * y el contrato saldría con `&lt;p&gt;` impreso adentro.
   *
   * El original se guarda y **la pantalla lo muestra**. Convertir es reescribir
   * un texto legal: si el conversor se comiera un salto de línea del bloque de
   * firmas, la única forma de darse cuenta es poder mirar lo que había antes.
   */
  async convertir(tenantId: string, id: string): Promise<Plantilla> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaPlantilla>(
        `${SELECT_PLANTILLA} WHERE id = $1`, [id],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa plantilla.');
      if (rows[0].contenido_formato === 'html') return aPlantilla(rows[0]);

      const html = sanitizarPlantilla(textoAHtml(rows[0].contenido)).html;
      const { rows: nuevas } = await ej.query<FilaPlantilla>(
        `UPDATE plantilla_doc
            SET contenido = $2,
                contenido_texto_original = contenido,
                contenido_formato = 'html',
                convertida_el = now()
          WHERE id = $1
        RETURNING id, tipo, nombre, contenido, contenido_formato, activa,
                  contenido_texto_original, convertida_el`,
        [id, html],
      );
      return aPlantilla(nuevas[0]);
    });
  }

  async borrar(tenantId: string, id: string): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query('DELETE FROM plantilla_doc WHERE id = $1', [id]);
      if (!rowCount) throw AppError.notFound('No se encontró esa plantilla.');
    });
  }

  /**
   * Genera un documento a partir de una plantilla y un contrato.
   *
   * Devuelve las variables que NO se pudieron completar. La UI las muestra
   * antes de que nadie imprima: un pre-contrato con un hueco es normal —hay
   * datos que se completan a mano— pero tiene que verse cuáles.
   */
  async generar(
    tenantId: string,
    plantillaId: string,
    contratoId: string,
  ): Promise<Documento> {
    return this.db.withTenant(tenantId, (ej) => this.generarCon(ej, plantillaId, contratoId));
  }

  /**
   * Lo mismo que `generar()`, pero con el ejecutor de afuera.
   *
   * Existe para que `DocumentosService` guarde el documento y lo renderice en
   * **una sola transacción**: si el contrato cambia entre las dos consultas, lo
   * que se guardaría como «lo que produjo el motor» no sería lo que produjo el
   * motor. `generar()` queda como la puerta pública y llama acá.
   */
  async generarCon(ej: Ejecutor, plantillaId: string, contratoId: string): Promise<Documento> {
    const { rows: p } = await ej.query<{
      id: string; tipo: string; nombre: string; contenido: string;
      contenido_formato: FormatoContenido;
    }>(
      'SELECT id, tipo, nombre, contenido, contenido_formato FROM plantilla_doc WHERE id = $1',
      [plantillaId],
    );
    if (!p.length) throw AppError.notFound('No se encontró esa plantilla.');

    const ctx = await this.contextoDeContrato(ej, contratoId);
    const formato = p[0].contenido_formato;
    const r = renderizar(p[0].contenido, ctx, { escaparHtml: formato === 'html' });

    return {
      // Un documento ya renderizado no tiene estructura que resolver: los divs
      // de bloque y los chips son andamio del editor de PLANTILLAS y acá sólo
      // estorban a quien edita el papel antes de mandarlo.
      texto: formato === 'html' ? aplanarDocumento(r.texto) : r.texto,
      formato,
      faltantes: r.faltantes,
      plantilla: { id: p[0].id, nombre: p[0].nombre, tipo: p[0].tipo },
    };
  }

  /**
   * Las partes del contrato que tienen algún dato de contacto.
   *
   * El locatario va primero: el pre-contrato se le manda a quien va a firmar
   * como inquilino en el 90% de los casos. Los que no tienen ni teléfono ni mail
   * quedan afuera de la lista en vez de aparecer como una opción que después no
   * se puede usar — un control que no va a funcionar es peor que su ausencia.
   */
  async destinatarios(tenantId: string, contratoId: string): Promise<Destinatario[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        nombre: string; rol: string; telefono: string | null; email: string | null;
      }>(
        `SELECT trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')) AS nombre,
                CASE WHEN cp.rol IN ('garante','fiador') THEN 'garante' ELSE cp.rol END AS rol,
                pe.telefono, pe.email
           FROM contrato_parte cp
           JOIN persona pe ON pe.id = cp.persona_id
          WHERE cp.contrato_id = $1
            AND (pe.telefono IS NOT NULL OR pe.email IS NOT NULL)
          ORDER BY CASE cp.rol WHEN 'locatario' THEN 0 WHEN 'locador' THEN 1 ELSE 2 END,
                   pe.apellido, pe.nombre`,
        [contratoId],
      );
      return rows as Destinatario[];
    });
  }

  /**
   * El recibo de un cobro concreto.
   *
   * Se registraba el cobro y no salía ningún papel; el inquilino que paga en
   * efectivo pide comprobante, y hasta ahora la respuesta era escribirlo a mano.
   *
   * Lo importante es que el recibo lleva **lo que realmente se cobró**, no el
   * alquiler nominal del contrato: si alguien pagó la mitad, el recibo dice la
   * mitad. Por eso el contexto suma `cobro.*` a lo que ya había, y se avisa si
   * la plantilla no lo usa.
   */
  async recibo(tenantId: string, cobroId: string): Promise<Documento> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: c } = await ej.query<{
        monto: string; moneda: string; fecha: string; medio: string;
        comprobante: string | null; imputacion: string;
        periodo: string; vence_el: string; contrato_id: string;
        total: string; cobrado_total: string; registrado_por: string | null;
      }>(
        `SELECT co.monto, co.moneda, co.fecha, co.medio, co.comprobante, co.imputacion,
                p.periodo, p.vence_el, p.total, c.id AS contrato_id,
                u.nombre AS registrado_por,
                coalesce((SELECT sum(x.monto) FROM cobro x
                           WHERE x.periodo_id = p.id AND x.imputacion = 'alquiler'), 0)
                  AS cobrado_total
           FROM cobro co
           JOIN periodo_alquiler p ON p.id = co.periodo_id
           JOIN contrato_alquiler c ON c.id = p.contrato_id
           LEFT JOIN usuario u ON u.id = co.registrado_por
          WHERE co.id = $1`,
        [cobroId],
      );
      if (!c.length) throw AppError.notFound('No se encontró ese cobro.');
      const co = c[0];

      const { rows: p } = await ej.query<{
        id: string; nombre: string; contenido: string; contenido_formato: FormatoContenido;
      }>(
        `SELECT id, nombre, contenido, contenido_formato FROM plantilla_doc
          WHERE tipo = 'recibo' AND activa ORDER BY nombre LIMIT 1`,
      );
      if (!p.length) {
        throw new AppError(
          422,
          ErrorCode.NOT_FOUND,
          'No hay ninguna plantilla de recibo. Cargá las plantillas base desde ' +
            'Plantillas → «Cargar las base», o escribí la tuya.',
          'Unprocessable Entity',
        );
      }

      const base = await this.contextoDeContrato(ej, co.contrato_id);
      const saldo = round2(Number(co.total) - Number(co.cobrado_total));

      const ctx: Contexto = {
        ...base,
        // La moneda del RECIBO es la del cobro, no la del contrato: son la misma
        // hoy, pero el formato `| moneda` la toma de la raíz y tiene que seguir
        // al importe que se está recibiendo.
        moneda: co.moneda,
        cobro: {
          monto: Number(co.monto),
          moneda: co.moneda,
          fecha: String(co.fecha).slice(0, 10),
          medio: ETIQUETA_MEDIO[co.medio] ?? co.medio,
          comprobante: co.comprobante,
          concepto: co.imputacion === 'punitorio' ? 'interés por mora' : 'alquiler',
          periodo: String(co.periodo).slice(0, 10),
          venceEl: String(co.vence_el).slice(0, 10),
          totalCuota: Number(co.total),
          saldo,
          // Un recibo por un pago parcial tiene que decirlo: si no, el inquilino
          // guarda un papel que parece cancelar el mes entero.
          //
          // La bandera va en POSITIVO (`esParcial`) porque el motor de plantillas
          // no tiene negación — y no se la voy a agregar: el día que tenga `!`,
          // `&&` y paréntesis dejó de ser un motor de plantillas y es un lenguaje
          // que alguien va a poder ejecutar desde un textarea.
          esParcial: saldo > 0,
          registradoPor: co.registrado_por,
          // El período, ya escrito: tampoco hay filtro `periodo` en el motor, y
          // formatear en el contexto es más simple que sumar sintaxis.
          periodoTexto: periodoLegible(String(co.periodo)),
        },
      };

      const formato = p[0].contenido_formato;
      const r = renderizar(p[0].contenido, ctx, { escaparHtml: formato === 'html' });

      // Si la plantilla no menciona el cobro, está imprimiendo el alquiler
      // nominal del contrato. Con un pago parcial eso es un recibo por un monto
      // que nadie pagó.
      const usaElCobro = /\{\{\s*cobro\./.test(p[0].contenido);

      return {
        texto: formato === 'html' ? aplanarDocumento(r.texto) : r.texto,
        formato,
        faltantes: r.faltantes,
        plantilla: { id: p[0].id, nombre: p[0].nombre, tipo: 'recibo' },
        ...(usaElCobro
          ? {}
          : {
              advertencia:
                'Esta plantilla de recibo no usa el monto realmente cobrado ' +
                '({{ cobro.monto }}): está imprimiendo el alquiler del contrato. ' +
                'Con un pago parcial, el recibo diría un monto que no se pagó.',
            }),
      };
    });
  }

  /**
   * Previsualiza una plantilla contra datos de ejemplo, sin tocar un contrato.
   *
   * También sanitiza, y no por prolijidad: acá entra HTML por el body y sale
   * por la respuesta directo a un `v-html` de la pantalla. Es un vector igual
   * de bueno que `guardar()`, con la diferencia de que no deja rastro en la
   * base — o sea, peor.
   */
  previsualizar(contenido: string, formato: FormatoContenido = 'html'): Documento & {
    avisos: string[];
    tokensRotos: TokenRoto[];
  } {
    const limpio = formato === 'html'
      ? sanitizarPlantilla(contenido)
      : { html: contenido, avisos: [] as string[] };
    const r = renderizar(limpio.html, EJEMPLO, { escaparHtml: formato === 'html' });
    return {
      texto: formato === 'html' ? aplanarDocumento(r.texto) : r.texto,
      formato,
      faltantes: r.faltantes,
      plantilla: { id: '', nombre: 'Ejemplo', tipo: 'otro' },
      avisos: limpio.avisos,
      // Sobre el contenido SIN renderizar: lo que se busca son los tokens que
      // el motor no va a entender, y después de renderizar ya no están.
      tokensRotos: tokensRotos(limpio.html),
    };
  }

  /** El contexto de ejemplo, para el test que lo confronta con el catálogo. */
  static get ejemplo(): Contexto {
    return EJEMPLO;
  }

  private async contextoDeContrato(ej: Ejecutor, contratoId: string): Promise<Contexto> {
    const { rows } = await ej.query<Record<string, unknown>>(
      `SELECT c.fecha_inicio, c.fecha_fin, c.dia_vencimiento, c.monto_inicial,
              c.moneda, c.indice, c.indice_porcentaje, c.periodicidad_meses,
              c.deposito, c.honorarios_pct, c.punitorio_diario_pct,
              coalesce((SELECT a.monto_nuevo FROM contrato_ajuste a
                         WHERE a.contrato_id = c.id
                           AND a.estado IN ('confirmado','notificado','aplicado')
                           AND a.vigente_desde <= current_date
                         ORDER BY a.vigente_desde DESC LIMIT 1),
                       c.monto_inicial) AS monto_vigente,
              pr.codigo, pr.calle, pr.numero, pr.piso, pr.depto, pr.localidad,
              pr.provincia, pr.tipo AS tipo_propiedad,
              t.nombre AS inmobiliaria, t.cuit AS inmobiliaria_cuit,
              -- telefono y email entran acá desde la 020. Se usan para el
              -- selector de destinatario del envío —antes no había a quién
              -- mandarle nada— y de paso quedan disponibles en la plantilla.
              -- (Sin comillas invertidas: adentro de un template literal cierran
              --  la cadena y tsc falla en la línea de abajo. Está en la tabla de
              --  trampas de docs/CONTINUAR.md.)
              (SELECT json_agg(json_build_object(
                  'nombre', trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')),
                  'documento', pe.doc_numero,
                  'tipoDocumento', upper(coalesce(pe.doc_tipo,'')),
                  'domicilio', pe.domicilio,
                  'telefono', pe.telefono,
                  'email', pe.email,
                  'porcentaje', cp.porcentaje) ORDER BY cp.porcentaje DESC NULLS LAST)
                 FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
                WHERE cp.contrato_id = c.id AND cp.rol = 'locador') AS locadores,
              (SELECT json_agg(json_build_object(
                  'nombre', trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')),
                  'documento', pe.doc_numero,
                  'tipoDocumento', upper(coalesce(pe.doc_tipo,'')),
                  'domicilio', pe.domicilio,
                  'telefono', pe.telefono,
                  'email', pe.email))
                 FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
                WHERE cp.contrato_id = c.id AND cp.rol = 'locatario') AS locatarios,
              (SELECT json_agg(json_build_object(
                  'nombre', trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')),
                  'documento', pe.doc_numero,
                  'domicilio', pe.domicilio,
                  'telefono', pe.telefono,
                  'email', pe.email))
                 FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
                WHERE cp.contrato_id = c.id AND cp.rol IN ('garante','fiador')) AS garantes
         FROM contrato_alquiler c
         JOIN propiedad pr ON pr.id = c.propiedad_id
         JOIN tenant t ON t.id = c.tenant_id
        WHERE c.id = $1`,
      [contratoId],
    );

    if (!rows.length) throw AppError.notFound('No se encontró ese contrato.');
    const r = rows[0];

    const locadores = (r.locadores as Contexto[]) ?? [];
    const locatarios = (r.locatarios as Contexto[]) ?? [];
    const garantes = (r.garantes as Contexto[]) ?? [];

    const ETIQUETA_INDICE: Record<string, string> = {
      ipc: 'IPC (INDEC)', icl: 'ICL (BCRA)', uva: 'UVA (BCRA)',
      icp: 'Casa Propia', porcentaje_fijo: 'porcentaje fijo', ninguno: 'sin actualización',
    };

    return {
      // `moneda` en la raíz: el formato `| moneda` la toma de ahí.
      moneda: r.moneda,
      hoy: new Date().toISOString().slice(0, 10),
      inmobiliaria: { nombre: r.inmobiliaria, cuit: r.inmobiliaria_cuit },
      propiedad: {
        codigo: `PROP-${String(r.codigo).padStart(4, '0')}`,
        direccion: [
          [r.calle, r.numero].filter(Boolean).join(' '),
          [r.piso && `piso ${r.piso}`, r.depto && `depto ${r.depto}`].filter(Boolean).join(' '),
          r.localidad, r.provincia,
        ].filter(Boolean).join(', '),
        tipo: r.tipo_propiedad,
        localidad: r.localidad,
      },
      contrato: {
        inicio: r.fecha_inicio,
        fin: r.fecha_fin,
        diaVencimiento: r.dia_vencimiento,
        monto: Number(r.monto_inicial),
        montoVigente: Number(r.monto_vigente),
        deposito: r.deposito === null ? null : Number(r.deposito),
        honorariosPct: Number(r.honorarios_pct),
        punitorioDiario: Number(r.punitorio_diario_pct),
        indice: ETIQUETA_INDICE[String(r.indice)] ?? r.indice,
        periodicidad: r.periodicidad_meses,
      },
      // Se exponen en singular y en plural: la mayoría de los contratos tiene
      // uno de cada lado, y escribir `{{ locador.nombre }}` es más natural que
      // abrir un `{% para %}` para un solo elemento.
      locador: locadores[0] ?? {},
      locatario: locatarios[0] ?? {},
      locadores,
      locatarios,
      garantes,
    };
  }
}

/** Datos de ejemplo para previsualizar una plantilla en el editor. */
const EJEMPLO: Contexto = {
  moneda: 'ARS',
  hoy: new Date().toISOString().slice(0, 10),
  inmobiliaria: { nombre: 'Inmobiliaria de Ejemplo', cuit: '30-71234567-9' },
  propiedad: {
    codigo: 'PROP-0001',
    direccion: 'Arístides Villanueva 345, piso 3 depto B, Ciudad, Mendoza',
    tipo: 'departamento', localidad: 'Ciudad',
  },
  contrato: {
    inicio: '2026-01-01', fin: '2028-12-31', diaVencimiento: 10,
    monto: 485000, montoVigente: 514682, deposito: 485000,
    honorariosPct: 8, punitorioDiario: 0.1,
    indice: 'IPC (INDEC)', periodicidad: 3,
  },
  locador: { nombre: 'Marta Silva', documento: '18456789', tipoDocumento: 'DNI', domicilio: 'San Martín 100' },
  locatario: { nombre: 'Camila Rossi', documento: '35222111', tipoDocumento: 'DNI', domicilio: 'Belgrano 250' },
  locadores: [{ nombre: 'Marta Silva', documento: '18456789', porcentaje: 100 }],
  locatarios: [{ nombre: 'Camila Rossi', documento: '35222111' }],
  garantes: [{ nombre: 'Jorge Ferreyra', documento: '22987654', domicilio: 'Rivadavia 80' }],
};
