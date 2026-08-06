import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { AlmacenamientoService } from '../archivos/almacenamiento.service';
import { DeudoresService } from './deudores.service';
import { SITUACION } from './situacion.motor';
import type { CrearGaranteDto, EditarGaranteDto } from './garantes.dto';

/**
 * El legajo del garante.
 *
 * Una inmobiliaria no alquila contra un nombre: alquila contra dos o tres
 * personas con recibo de sueldo, sus documentos sobre la mesa y la certeza de
 * que no arrastran una deuda. Eso era hasta ahora una carpeta de papel y un
 * WhatsApp con fotos; `garantia` existía en la base desde la 007 y no la leía
 * nadie.
 *
 * Tres reglas que este servicio hace cumplir:
 *
 * 1. **El veredicto del BCRA se congela.** Se guarda lo que la Central de
 *    Deudores respondió el día que se consultó, no un puntero para volver a
 *    preguntar. Es la misma regla del ajuste por índice: la decisión se tomó
 *    con ese dato.
 *
 * 2. **Apto o no apto se DERIVA de la situación guardada**, no es un campo que
 *    alguien marque. Es la decisión de la etapa 3 otra vez: un dato derivado no
 *    se desincroniza.
 *
 * 3. **Nada se da por bueno sin consultar.** Un garante sin consulta no es apto
 *    ni deja de serlo: está sin verificar, y la pantalla lo dice distinto.
 */

/**
 * Dos garantes es el piso que pidió el dueño, con tres como práctica habitual.
 * No bloquea la carga del contrato —los contratos que ya existen se cargaron
 * sin esto y el sistema no puede negarse a representarlos— pero la verificación
 * lo informa en cada contrato.
 */
export const MINIMO_GARANTES = 2;

/** Lo que tiene que presentar cada garante para que el legajo esté completo. */
export const DOCUMENTOS_REQUERIDOS = [
  'dni_frente', 'dni_dorso', 'recibo_1', 'recibo_2', 'recibo_3',
] as const;

export const ETIQUETA_DOCUMENTO: Record<string, string> = {
  dni_frente: 'DNI · frente',
  dni_dorso: 'DNI · dorso',
  recibo_1: 'Recibo de sueldo 1',
  recibo_2: 'Recibo de sueldo 2',
  recibo_3: 'Recibo de sueldo 3',
  otro: 'Otro documento',
};

export interface DocumentoGarante {
  id: string;
  tipo: string;
  etiqueta: string;
  url: string;
  nombreOriginal: string | null;
  subidoEl: string;
}

export interface Garante {
  id: string;
  contratoId: string;
  personaId: string | null;
  nombre: string;
  documento: string | null;
  tipo: string;
  detalle: string | null;
  venceEl: string | null;
  firmoEl: string | null;

  bcra: {
    consultado: boolean;
    cuit: string | null;
    denominacion: string | null;
    situacion: number | null;
    situacionTexto: string | null;
    periodo: string | null;
    consultadoEl: string | null;
    apto: boolean | null;
    motivo: string | null;
    entidades: unknown[];
    advertencias: string[];
  };

  documentos: DocumentoGarante[];
  faltan: string[];
  legajoCompleto: boolean;
}

export interface VerificacionContrato {
  garantes: number;
  aptos: number;
  minimo: number;
  enRegla: boolean;
  /** Qué le falta al contrato para estar en regla, en castellano. */
  pendientes: string[];
}

@Injectable()
export class GarantesService {
  constructor(
    private readonly db: DbService,
    private readonly almacen: AlmacenamientoService,
    private readonly deudores: DeudoresService,
  ) {}

  async listar(tenantId: string, contratoId: string): Promise<Garante[]> {
    return this.db.withTenant(tenantId, (ej) => this.leerDe(ej, contratoId));
  }

  /**
   * El estado del contrato de un vistazo.
   *
   * Se calcula sobre los garantes cargados y no se guarda en ningún lado: es la
   * misma decisión que los roles de una persona. Un contrato al que le sacan un
   * garante deja de estar en regla en el mismo instante, sin que nadie corra
   * nada.
   */
  async verificar(tenantId: string, contratoId: string): Promise<VerificacionContrato> {
    const garantes = await this.listar(tenantId, contratoId);
    const aptos = garantes.filter((g) => g.bcra.apto === true && g.legajoCompleto && g.firmoEl);

    const pendientes: string[] = [];
    if (garantes.length < MINIMO_GARANTES) {
      pendientes.push(
        `Faltan garantes: hay ${garantes.length} y el mínimo es ${MINIMO_GARANTES}.`,
      );
    }
    for (const g of garantes) {
      if (g.bcra.consultado === false) {
        pendientes.push(`${g.nombre}: falta consultar el BCRA.`);
      } else if (g.bcra.apto === false) {
        pendientes.push(`${g.nombre}: ${g.bcra.motivo}`);
      }
      if (g.faltan.length) {
        pendientes.push(
          `${g.nombre}: falta ${g.faltan.map((t) => ETIQUETA_DOCUMENTO[t] ?? t).join(', ')}.`,
        );
      }
      if (!g.firmoEl) pendientes.push(`${g.nombre}: todavía no firmó el contrato.`);
    }

    return {
      garantes: garantes.length,
      aptos: aptos.length,
      minimo: MINIMO_GARANTES,
      enRegla: aptos.length >= MINIMO_GARANTES,
      pendientes,
    };
  }

  async crear(tenantId: string, contratoId: string, dto: CrearGaranteDto): Promise<Garante> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        'SELECT 1 FROM contrato_alquiler WHERE id = $1',
        [contratoId],
      );
      if (!rowCount) throw AppError.notFound('No se encontró ese contrato.');

      const { rowCount: existePersona } = await ej.query(
        'SELECT 1 FROM persona WHERE id = $1',
        [dto.personaId],
      );
      if (!existePersona) throw AppError.notFound('No se encontró esa persona.');

      let id: string;
      try {
        const { rows } = await ej.query<{ id: string }>(
          `INSERT INTO garantia (tenant_id, contrato_id, persona_id, tipo, detalle, vence_el)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [tenantId, contratoId, dto.personaId, dto.tipo ?? 'garante_solidario',
            dto.detalle ?? null, dto.venceEl ?? null],
        );
        id = rows[0].id;
      } catch (err) {
        if (esDuplicado(err)) {
          throw new AppError(
            409, ErrorCode.OPERACION_DUPLICADA,
            'Esa persona ya garantiza este contrato.', 'Conflict',
          );
        }
        throw err;
      }

      // La misma persona puede ser garante y locatario por error de carga. Se
      // agrega también como parte del contrato con rol garante para que el
      // pre-contrato la imprima: la plantilla lee `contrato_parte`, no esta
      // tabla, y un garante que no sale en el contrato no garantiza nada.
      await ej.query(
        `INSERT INTO contrato_parte (tenant_id, contrato_id, persona_id, rol)
         VALUES ($1, $2, $3, 'garante')
         ON CONFLICT DO NOTHING`,
        [tenantId, contratoId, dto.personaId],
      );

      return (await this.leerDe(ej, contratoId, id))[0];
    });
  }

  async editar(tenantId: string, garanteId: string, dto: EditarGaranteDto): Promise<Garante> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ contrato_id: string }>(
        `UPDATE garantia SET
           tipo     = coalesce($2, tipo),
           detalle  = coalesce($3, detalle),
           vence_el = coalesce($4, vence_el),
           firmo_el = coalesce($5, firmo_el)
         WHERE id = $1 RETURNING contrato_id`,
        [garanteId, dto.tipo ?? null, dto.detalle ?? null,
          dto.venceEl ?? null, dto.firmoEl ?? null],
      );
      if (!rows.length) throw AppError.notFound('No se encontró ese garante.');
      return (await this.leerDe(ej, rows[0].contrato_id, garanteId))[0];
    });
  }

  async borrar(tenantId: string, garanteId: string): Promise<void> {
    const urls = await this.db.withTenant(tenantId, async (ej) => {
      const { rows: docs } = await ej.query<{ url: string }>(
        'SELECT url FROM garantia_documento WHERE garantia_id = $1',
        [garanteId],
      );
      const { rowCount } = await ej.query('DELETE FROM garantia WHERE id = $1', [garanteId]);
      if (!rowCount) throw AppError.notFound('No se encontró ese garante.');
      return docs.map((d) => d.url);
    });

    // Los documentos se van con la fila por CASCADE; los archivos del bucket no
    // los borra nadie más que esto.
    for (const url of urls) {
      const clave = this.almacen.claveDeUrl(url);
      if (clave) await this.almacen.borrar(clave);
    }
  }

  /**
   * Consulta la Central de Deudores y congela la respuesta.
   *
   * El documento sale de la persona: si no tiene uno cargado, no hay nada que
   * consultar y se dice así en vez de devolver un veredicto vacío que parezca
   * un "está todo bien".
   */
  async consultarBcra(tenantId: string, garanteId: string): Promise<Garante> {
    const datos = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        contrato_id: string; doc_numero: string | null; nombre: string;
      }>(
        `SELECT g.contrato_id, p.doc_numero,
                trim(coalesce(p.nombre,'') || ' ' || coalesce(p.apellido,'')) AS nombre
           FROM garantia g LEFT JOIN persona p ON p.id = g.persona_id
          WHERE g.id = $1`,
        [garanteId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró ese garante.');
      return rows[0];
    });

    if (!datos.doc_numero) {
      throw new AppError(
        422, ErrorCode.VALIDATION_FAILED,
        `${datos.nombre || 'El garante'} no tiene documento cargado, y la Central de ` +
          'Deudores se consulta por DNI o CUIL. Cargalo en su ficha y volvé a intentar.',
        'Unprocessable Entity',
      );
    }

    const r = await this.deudores.consultar(datos.doc_numero);
    if (!r) {
      throw new AppError(
        503, ErrorCode.DB_UNAVAILABLE,
        'No se pudo consultar la Central de Deudores del BCRA. No se guardó ningún ' +
          'resultado: un garante sin verificar no es lo mismo que uno aprobado.',
        'Service Unavailable',
      );
    }

    return this.db.withTenant(tenantId, async (ej) => {
      await ej.query(
        `UPDATE garantia SET
           bcra_cuit = $2, bcra_denominacion = $3, bcra_situacion = $4,
           bcra_periodo = $5, bcra_consultado_el = now(), bcra_detalle = $6
         WHERE id = $1`,
        [
          garanteId, r.cuit, r.denominacion, r.peorSituacion, r.periodo,
          JSON.stringify({
            apto: r.apto,
            motivo: r.motivo,
            entidades: r.entidades,
            advertencias: r.advertencias,
            probados: r.probados,
          }),
        ],
      );
      return (await this.leerDe(ej, datos.contrato_id, garanteId))[0];
    });
  }

  async subirDocumento(
    tenantId: string,
    garanteId: string,
    tipo: string,
    datos: Buffer,
    nombreOriginal: string | undefined,
    usuarioId: string,
  ): Promise<Garante> {
    // Se valida antes de subir: un archivo huérfano en el bucket no lo limpia
    // nadie.
    const contratoId = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ contrato_id: string }>(
        'SELECT contrato_id FROM garantia WHERE id = $1',
        [garanteId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró ese garante.');
      return rows[0].contrato_id;
    });

    const subido = await this.almacen.subirImagen(
      tenantId, `garantes/${garanteId}`, datos, nombreOriginal,
    );

    try {
      return await this.db.withTenant(tenantId, async (ej) => {
        // Volver a subir el mismo tipo reemplaza: dos frentes de DNI y nadie
        // sabe cuál mirar. El anterior se borra del bucket abajo.
        const { rows: viejos } = await ej.query<{ url: string }>(
          `DELETE FROM garantia_documento
            WHERE garantia_id = $1 AND tipo = $2 AND tipo <> 'otro'
            RETURNING url`,
          [garanteId, tipo],
        );

        await ej.query(
          `INSERT INTO garantia_documento
             (tenant_id, garantia_id, tipo, url, nombre_original, subido_por)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenantId, garanteId, tipo, subido.url, nombreOriginal ?? null, usuarioId],
        );

        for (const v of viejos) {
          const clave = this.almacen.claveDeUrl(v.url);
          if (clave) await this.almacen.borrar(clave);
        }

        return (await this.leerDe(ej, contratoId, garanteId))[0];
      });
    } catch (err) {
      await this.almacen.borrar(subido.clave);
      throw err;
    }
  }

  async borrarDocumento(
    tenantId: string,
    garanteId: string,
    documentoId: string,
  ): Promise<Garante> {
    const { contratoId, url } = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ url: string; garantia_id: string }>(
        'DELETE FROM garantia_documento WHERE id = $1 AND garantia_id = $2 RETURNING url, garantia_id',
        [documentoId, garanteId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró ese documento.');

      const { rows: g } = await ej.query<{ contrato_id: string }>(
        'SELECT contrato_id FROM garantia WHERE id = $1',
        [garanteId],
      );
      return { contratoId: g[0].contrato_id, url: rows[0].url };
    });

    const clave = this.almacen.claveDeUrl(url);
    if (clave) await this.almacen.borrar(clave);

    return (await this.listar(tenantId, contratoId)).find((g) => g.id === garanteId)!;
  }

  /** Una sola consulta con los documentos agregados: no una por garante. */
  private async leerDe(
    ej: Ejecutor,
    contratoId: string,
    soloId?: string,
  ): Promise<Garante[]> {
    const { rows } = await ej.query<FilaGarante>(
      `SELECT g.id, g.contrato_id, g.persona_id, g.tipo, g.detalle,
              g.vence_el, g.firmo_el,
              g.bcra_cuit, g.bcra_denominacion, g.bcra_situacion,
              g.bcra_periodo, g.bcra_consultado_el, g.bcra_detalle,
              trim(coalesce(p.nombre,'') || ' ' || coalesce(p.apellido,'')) AS nombre,
              p.doc_numero,
              (SELECT json_agg(json_build_object(
                  'id', d.id, 'tipo', d.tipo, 'url', d.url,
                  'nombreOriginal', d.nombre_original, 'subidoEl', d.created_at)
                 ORDER BY d.tipo)
                 FROM garantia_documento d WHERE d.garantia_id = g.id) AS documentos
         FROM garantia g
         LEFT JOIN persona p ON p.id = g.persona_id
        WHERE g.contrato_id = $1 AND ($2::uuid IS NULL OR g.id = $2)
        ORDER BY g.created_at`,
      [contratoId, soloId ?? null],
    );

    return rows.map(aGarante);
  }
}

interface FilaGarante {
  id: string;
  contrato_id: string;
  persona_id: string | null;
  tipo: string;
  detalle: string | null;
  vence_el: string | null;
  firmo_el: string | null;
  bcra_cuit: string | null;
  bcra_denominacion: string | null;
  bcra_situacion: number | null;
  bcra_periodo: string | null;
  bcra_consultado_el: Date | null;
  bcra_detalle: {
    apto?: boolean; motivo?: string; entidades?: unknown[]; advertencias?: string[];
  } | null;
  nombre: string | null;
  doc_numero: string | null;
  documentos: Array<{
    id: string; tipo: string; url: string;
    nombreOriginal: string | null; subidoEl: string;
  }> | null;
}

function aGarante(f: FilaGarante): Garante {
  const documentos = (f.documentos ?? []).map((d) => ({
    ...d,
    etiqueta: ETIQUETA_DOCUMENTO[d.tipo] ?? d.tipo,
    subidoEl: new Date(d.subidoEl).toISOString(),
  }));

  const presentes = new Set(documentos.map((d) => d.tipo));
  const faltan = DOCUMENTOS_REQUERIDOS.filter((t) => !presentes.has(t));
  const consultado = f.bcra_consultado_el !== null;

  return {
    id: f.id,
    contratoId: f.contrato_id,
    personaId: f.persona_id,
    nombre: f.nombre?.trim() || 'Sin nombre',
    documento: f.doc_numero,
    tipo: f.tipo,
    detalle: f.detalle,
    // `date` de Postgres no lleva zona: se recorta el texto en vez de pasarlo
    // por `Date`, que le inventaría una medianoche UTC y correría el día.
    venceEl: f.vence_el ? String(f.vence_el).slice(0, 10) : null,
    firmoEl: f.firmo_el ? String(f.firmo_el).slice(0, 10) : null,

    bcra: {
      consultado,
      cuit: f.bcra_cuit,
      denominacion: f.bcra_denominacion,
      situacion: f.bcra_situacion,
      situacionTexto: f.bcra_situacion ? (SITUACION[f.bcra_situacion] ?? null) : null,
      periodo: f.bcra_periodo,
      consultadoEl: f.bcra_consultado_el?.toISOString() ?? null,
      // Sin consulta no hay veredicto. `null` no es `false`: uno es "no lo
      // sabemos" y el otro "lo verificamos y no pasa".
      apto: consultado ? (f.bcra_detalle?.apto ?? null) : null,
      motivo: consultado ? (f.bcra_detalle?.motivo ?? null) : null,
      entidades: f.bcra_detalle?.entidades ?? [],
      advertencias: f.bcra_detalle?.advertencias ?? [],
    },

    documentos,
    faltan,
    legajoCompleto: faltan.length === 0,
  };
}

function esDuplicado(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && 'code' in err &&
    (err as { code: string }).code === '23505'
  );
}
