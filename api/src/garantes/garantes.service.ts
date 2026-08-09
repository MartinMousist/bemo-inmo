import { Injectable, Logger } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { AlmacenamientoService } from '../archivos/almacenamiento.service';
import { RecordatoriosService } from '../recordatorios/recordatorios.service';
import { DeudoresService } from './deudores.service';
import { SITUACION, proximaRevision, type VeredictoCheques } from './situacion.motor';
import { normalizarAr } from './telefono.motor';
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
 *
 * 4. **Congelar no es no volver a mirar.** El veredicto que respaldó la firma no
 *    se pisa nunca, y aun así hay que volver a preguntar: un contrato dura tres
 *    años y quien estaba en situación 1 en enero puede estar en 3 en junio. Por
 *    eso cada consulta escribe una fila en `garantia_bcra_consulta` y
 *    `garantia.bcra_*` queda como cache de la última. La primera del historial
 *    es la que respaldó la firma, y sigue ahí.
 *
 * 5. **La re-consulta la aprieta una persona.** El sistema calcula la fecha y
 *    avisa; salir a buscar el dato bancario de un tercero sin que nadie lo pida
 *    es lo que NO se hace. Un cron que consultara solo repetiría a escala el
 *    incidente que ya está anotado en docs/CONTINUAR.md —una consulta con un
 *    DNI demo trajo la deuda de una persona real— y encima cada seis meses.
 */

/**
 * Dos garantes es el piso que pidió el dueño, con tres como práctica habitual.
 * No bloquea la carga del contrato —los contratos que ya existen se cargaron
 * sin esto y el sistema no puede negarse a representarlos— pero la verificación
 * lo informa en cada contrato.
 */
export const MINIMO_GARANTES = 2;

/** Lo que tiene que presentar un garante PERSONA para que el legajo esté completo. */
export const DOCUMENTOS_REQUERIDOS = [
  'dni_frente', 'dni_dorso', 'recibo_1', 'recibo_2', 'recibo_3',
] as const;

/**
 * Lo que se le pide a una garantía SIN persona: el comprobante.
 *
 * Un seguro de caución no tiene las dos caras del DNI ni tres recibos de
 * sueldo, y pedírselos no es sólo raro: es una lista de pendientes que **nunca
 * se va a poder completar**, mostrada al lado de las que sí. Lo que tiene que
 * estar adjunto es la póliza.
 */
export const DOCUMENTO_COMPROBANTE = 'otro';

export const ETIQUETA_DOCUMENTO: Record<string, string> = {
  dni_frente: 'DNI · frente',
  dni_dorso: 'DNI · dorso',
  recibo_1: 'Recibo de sueldo 1',
  recibo_2: 'Recibo de sueldo 2',
  recibo_3: 'Recibo de sueldo 3',
  otro: 'Otro documento',
};

/** Los seis tipos de la 007, en castellano. Una póliza no se llama «Sin nombre». */
export const ETIQUETA_TIPO_GARANTIA: Record<string, string> = {
  propietaria: 'Garantía propietaria',
  recibo_sueldo: 'Recibo de sueldo',
  seguro_caucion: 'Seguro de caución',
  garante_solidario: 'Garante solidario',
  deposito_ampliado: 'Depósito ampliado',
  otra: 'Otra garantía',
};

/** Igual que la de arriba, pero redactada para la frase «falta …». */
const ETIQUETA_FALTANTE: Record<string, string> = {
  ...ETIQUETA_DOCUMENTO,
  otro: 'el comprobante de la garantía (la póliza o el contrato)',
};

/** Qué documentos le faltan a esta garantía, según tenga persona o no. */
export function documentosQueFaltan(tienePersona: boolean, presentes: Set<string>): string[] {
  if (!tienePersona) {
    return presentes.has(DOCUMENTO_COMPROBANTE) ? [] : [DOCUMENTO_COMPROBANTE];
  }
  return DOCUMENTOS_REQUERIDOS.filter((t) => !presentes.has(t));
}

export interface DocumentoGarante {
  id: string;
  tipo: string;
  etiqueta: string;
  url: string;
  nombreOriginal: string | null;
  subidoEl: string;
}

/** Lo que hace falta para abrir un WhatsApp — o para no ofrecerlo. */
export interface WhatsappGarante {
  /** 13 dígitos listos para `wa.me/{numero}`. `null` = no se puede armar. */
  numero: string | null;
  /** Por qué no se puede. La pantalla lo muestra en vez del botón. */
  motivo: string | null;
}

/** Las consultas al BCRA de este garante, sin traerlas todas. */
export interface HistorialBcra {
  consultas: number;
  /** La que respaldó la firma. Es la más vieja: dato derivado, no una marca. */
  primera: { el: string; situacion: number | null; apto: boolean | null } | null;
  ultima: { el: string; situacion: number | null; apto: boolean | null } | null;
}

export interface Garante {
  id: string;
  contratoId: string;
  personaId: string | null;
  nombre: string;
  documento: string | null;
  /** Tal como está cargado en la ficha, para poder corregirlo si está mal. */
  telefono: string | null;
  email: string | null;
  whatsapp: WhatsappGarante;
  tipo: string;
  tipoTexto: string;
  detalle: string | null;
  venceEl: string | null;
  /** La garantía ya venció. Sólo puede pasar con las que tienen `venceEl`. */
  vencida: boolean;
  firmoEl: string | null;

  bcra: {
    consultado: boolean;
    cuit: string | null;
    denominacion: string | null;
    situacion: number | null;
    situacionTexto: string | null;
    periodo: string | null;
    /** La ÚLTIMA consulta. La que respaldó la firma está en `historial.primera`. */
    consultadoEl: string | null;
    apto: boolean | null;
    motivo: string | null;
    entidades: unknown[];
    advertencias: string[];

    /** Cuándo corresponde volver a consultar. `null` = no corresponde. */
    revisarEl: string | null;
    /** Por qué esa fecha (o por qué ninguna). Todo cálculo lleva su memoria. */
    revisionMemoria: string | null;
    revisionVencida: boolean;

    /**
     * Cheques rechazados. `null` con `consultado: true` significa que las
     * deudas se consultaron y los cheques no — que no es lo mismo que «no
     * tiene». `chequesError` dice por qué.
     */
    cheques: VeredictoCheques | null;
    chequesError: string | null;

    historial: HistorialBcra;
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
  private readonly logger = new Logger('Garantes');

  constructor(
    private readonly db: DbService,
    private readonly almacen: AlmacenamientoService,
    private readonly deudores: DeudoresService,
    private readonly recordatorios: RecordatoriosService,
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

    // Una garantía CON persona se acepta cuando el BCRA la aprobó, presentó
    // todo y firmó. Una SIN persona —una póliza de caución— no tiene BCRA que
    // consultar ni firma que dar: vale mientras esté adjunta y no haya vencido.
    // Medirlas con la misma vara dejaba a la caución afuera para siempre.
    const aptos = garantes.filter((g) =>
      g.personaId
        ? g.bcra.apto === true && g.legajoCompleto && g.firmoEl
        : g.legajoCompleto && !g.vencida,
    );

    const pendientes: string[] = [];
    if (garantes.length < MINIMO_GARANTES) {
      pendientes.push(
        `Faltan garantes: hay ${garantes.length} y el mínimo es ${MINIMO_GARANTES}.`,
      );
    }
    for (const g of garantes) {
      if (g.vencida) {
        pendientes.push(
          `${g.nombre}: la garantía venció el ${ddmmaaaa(g.venceEl!)}. Pedí la renovación.`,
        );
      }
      if (!g.personaId) {
        // Sin persona no hay documento con el que consultar la Central de
        // Deudores. «Falta consultar el BCRA» sobre una póliza es un pendiente
        // que nadie puede resolver.
      } else if (g.bcra.consultado === false) {
        pendientes.push(`${g.nombre}: falta consultar el BCRA.`);
      } else if (g.bcra.apto === false) {
        pendientes.push(`${g.nombre}: ${g.bcra.motivo}`);
      } else if (g.bcra.revisionVencida) {
        // Informa, no bloquea: el contrato sigue y el garante sigue contando
        // como apto con el veredicto que tiene. Lo que hay es un dato viejo, y
        // un dato viejo no es un rechazo — es un botón que alguien tiene que
        // apretar.
        pendientes.push(
          `${g.nombre}: la revisión del BCRA venció el ${ddmmaaaa(g.bcra.revisarEl!)}. ` +
            'Volvé a consultarlo.',
        );
      }
      if (g.faltan.length) {
        pendientes.push(
          `${g.nombre}: falta ${g.faltan.map((t) => ETIQUETA_FALTANTE[t] ?? t).join(', ')}.`,
        );
      }
      // Una póliza no firma el contrato: la firmó el tomador cuando la contrató.
      // Pedirle la firma a un seguro de caución es un pendiente imposible.
      if (!g.firmoEl && g.personaId) {
        pendientes.push(`${g.nombre}: todavía no firmó el contrato.`);
      }
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
      // `coalesce` en todo salvo `vence_el`: lo que no viene en el PATCH no se
      // pisa con NULL —la trampa que ya borró número, ambientes y metros de una
      // propiedad— pero sobre `vence_el` hay un recordatorio, así que mandar
      // `null` explícito tiene que poder borrarla. `$6` distingue «no vino» de
      // «vino en null», que es lo único que `coalesce` no sabe hacer.
      const { rows } = await ej.query<{ contrato_id: string }>(
        `UPDATE garantia SET
           tipo     = coalesce($2, tipo),
           detalle  = coalesce($3, detalle),
           vence_el = CASE WHEN $6::boolean THEN $4::date ELSE vence_el END,
           firmo_el = coalesce($5, firmo_el)
         WHERE id = $1 RETURNING contrato_id`,
        [garanteId, dto.tipo ?? null, dto.detalle ?? null,
          dto.venceEl ?? null, dto.firmoEl ?? null,
          dto.venceEl !== undefined],
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

    // Los avisos de una garantía que ya no existe no los cancela el CASCADE:
    // `evento_programado.entidad_id` no es una FK —apunta a cinco tablas
    // distintas según `entidad_tipo`— así que las filas quedan vivas y la
    // bandeja sigue pidiendo que se revise el BCRA de un garante que se quitó.
    // `cancelarDe()` estaba escrito desde la etapa 7 y no lo llamaba nadie: el
    // error #3 del playbook, otra vez.
    await this.recordatorios.cancelarDe(tenantId, garanteId);

    // Los documentos se van con la fila por CASCADE; los archivos del bucket no
    // los borra nadie más que esto.
    for (const url of urls) {
      const clave = this.almacen.claveDeUrl(url);
      if (clave) await this.almacen.borrar(clave);
    }
  }

  /**
   * Consulta la Central de Deudores —deudas y cheques rechazados— y guarda la
   * respuesta.
   *
   * El documento sale de la persona: si no tiene uno cargado, no hay nada que
   * consultar y se dice así en vez de devolver un veredicto vacío que parezca
   * un "está todo bien".
   *
   * Los dos endpoints van con el mismo botón, y **no pesan lo mismo**: sin
   * deudas no hay veredicto y la consulta entera se descarta —así funciona
   * desde la 018 y no cambia—, pero si fallan sólo los cheques se guarda igual
   * el veredicto bueno con la nota de que quedaron sin consultar. Tirar una
   * consulta de deudas que salió bien porque el segundo endpoint devolvió 429
   * sería perder el dato que importa por el que acompaña.
   */
  async consultarBcra(
    tenantId: string,
    garanteId: string,
    usuarioId: string,
  ): Promise<Garante> {
    const datos = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        contrato_id: string; doc_numero: string | null; nombre: string;
        vence_el: string | null; fecha_inicio: string; fecha_fin: string;
      }>(
        `SELECT g.contrato_id, p.doc_numero, g.vence_el,
                c.fecha_inicio, c.fecha_fin,
                trim(coalesce(p.nombre,'') || ' ' || coalesce(p.apellido,'')) AS nombre
           FROM garantia g
           JOIN contrato_alquiler c ON c.id = g.contrato_id
           LEFT JOIN persona p ON p.id = g.persona_id
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

    const cheques = await this.deudores.consultarCheques(r.cuit);
    if (!cheques) {
      this.logger.warn(
        `Cheques rechazados sin consultar para la garantía ${garanteId}: se guarda ` +
          'igual el veredicto de deudas.',
      );
    }
    const chequesError = cheques
      ? null
      : 'No se pudieron consultar los cheques rechazados en esta consulta. El ' +
        'veredicto de deudas sí se guardó.';

    // `date` de Postgres: se recorta el texto en vez de pasarlo por `Date`, que
    // le inventaría una medianoche UTC y correría el día.
    const revision = proximaRevision({
      consultadoEl: new Date().toISOString().slice(0, 10),
      apto: r.apto,
      contratoDesde: String(datos.fecha_inicio).slice(0, 10),
      contratoHasta: String(datos.fecha_fin).slice(0, 10),
      garantiaVenceEl: datos.vence_el ? String(datos.vence_el).slice(0, 10) : null,
    });

    const detalle = JSON.stringify({
      apto: r.apto,
      motivo: r.motivo,
      entidades: r.entidades,
      advertencias: r.advertencias,
      probados: r.probados,
      revisionMemoria: revision.memoria,
    });

    return this.db.withTenant(tenantId, async (ej) => {
      // El cache de la última consulta.
      await ej.query(
        `UPDATE garantia SET
           bcra_cuit = $2, bcra_denominacion = $3, bcra_situacion = $4,
           bcra_periodo = $5, bcra_consultado_el = now(), bcra_detalle = $6,
           bcra_cheques = $7, bcra_revisar_el = $8
         WHERE id = $1`,
        [
          garanteId, r.cuit, r.denominacion, r.peorSituacion, r.periodo, detalle,
          cheques ? JSON.stringify(cheques) : null,
          revision.fecha,
        ],
      );

      // Y el historial, que es la fuente. Sin esta fila, la revisión de junio
      // borraría el veredicto de enero — que es exactamente el dato que explica
      // por qué se aceptó a este garante.
      await ej.query(
        `INSERT INTO garantia_bcra_consulta
           (tenant_id, garantia_id, consultado_por, cuit, denominacion, situacion,
            periodo, apto, motivo, detalle, cheques, cheques_error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          tenantId, garanteId, usuarioId, r.cuit, r.denominacion, r.peorSituacion,
          r.periodo, r.apto, r.motivo, detalle,
          cheques ? JSON.stringify(cheques) : null, chequesError,
        ],
      );

      // Una consulta nueva reemplaza al aviso de revisión anterior: si quedara
      // pendiente, la bandeja seguiría pidiendo lo que se acaba de hacer.
      await ej.query(
        `UPDATE evento_programado SET estado = 'cancelado'
          WHERE entidad_id = $1 AND tipo = 'garantia_revision_bcra'
            AND estado = 'pendiente'`,
        [garanteId],
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
              g.bcra_revisar_el, g.bcra_cheques,
              trim(coalesce(p.nombre,'') || ' ' || coalesce(p.apellido,'')) AS nombre,
              p.doc_numero, p.telefono, p.email,
              (SELECT json_agg(json_build_object(
                  'id', d.id, 'tipo', d.tipo, 'url', d.url,
                  'nombreOriginal', d.nombre_original, 'subidoEl', d.created_at)
                 ORDER BY d.tipo)
                 FROM garantia_documento d WHERE d.garantia_id = g.id) AS documentos,
              -- El historial agregado y no traído entero: de las N consultas la
              -- pantalla muestra dos —la que respaldó la firma y la de hoy— y
              -- traer el resto sería cargar un jsonb por garante para tirarlo.
              (SELECT json_build_object(
                  'consultas', count(*),
                  'primera', (array_agg(json_build_object(
                     'el', h.consultado_el, 'situacion', h.situacion, 'apto', h.apto)
                     ORDER BY h.consultado_el ASC))[1],
                  'ultima', (array_agg(json_build_object(
                     'el', h.consultado_el, 'situacion', h.situacion, 'apto', h.apto)
                     ORDER BY h.consultado_el DESC))[1],
                  'chequesError', (array_agg(h.cheques_error
                     ORDER BY h.consultado_el DESC))[1])
                 FROM garantia_bcra_consulta h WHERE h.garantia_id = g.id) AS historial
         FROM garantia g
         LEFT JOIN persona p ON p.id = g.persona_id
        WHERE g.contrato_id = $1 AND ($2::uuid IS NULL OR g.id = $2)
        -- El id desempata: dos garantes cargados en el mismo INSERT comparten
        -- created_at al microsegundo (el seed los carga así) y sin criterio de
        -- desempate el motor devuelve el orden que quiere. La lista se
        -- reordenaba sola entre dos recargas.
        ORDER BY g.created_at, g.id`,
      [contratoId, soloId ?? null],
    );

    // `current_date` de la base y no `new Date()` del proceso: la revisión
    // vencida se compara contra el mismo día que usan los emisores de aviso.
    const { rows: hoy } = await ej.query<{ hoy: string }>(
      "SELECT to_char(current_date, 'YYYY-MM-DD') AS hoy",
    );

    return rows.map((f) => aGarante(f, hoy[0].hoy));
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
    apto?: boolean; motivo?: string; entidades?: unknown[];
    advertencias?: string[]; revisionMemoria?: string;
  } | null;
  bcra_revisar_el: string | null;
  bcra_cheques: VeredictoCheques | null;
  nombre: string | null;
  doc_numero: string | null;
  telefono: string | null;
  email: string | null;
  documentos: Array<{
    id: string; tipo: string; url: string;
    nombreOriginal: string | null; subidoEl: string;
  }> | null;
  historial: {
    consultas: number;
    primera: { el: string; situacion: number | null; apto: boolean | null } | null;
    ultima: { el: string; situacion: number | null; apto: boolean | null } | null;
    chequesError: string | null;
  } | null;
}

function aGarante(f: FilaGarante, hoy: string): Garante {
  const documentos = (f.documentos ?? []).map((d) => ({
    ...d,
    etiqueta: ETIQUETA_DOCUMENTO[d.tipo] ?? d.tipo,
    subidoEl: new Date(d.subidoEl).toISOString(),
  }));

  const presentes = new Set(documentos.map((d) => d.tipo));
  const faltan = documentosQueFaltan(f.persona_id !== null, presentes);
  const consultado = f.bcra_consultado_el !== null;

  // `date` de Postgres no lleva zona: se recorta el texto en vez de pasarlo
  // por `Date`, que le inventaría una medianoche UTC y correría el día.
  const revisarEl = f.bcra_revisar_el ? String(f.bcra_revisar_el).slice(0, 10) : null;
  const venceEl = f.vence_el ? String(f.vence_el).slice(0, 10) : null;

  return {
    id: f.id,
    contratoId: f.contrato_id,
    personaId: f.persona_id,
    nombre: f.nombre?.trim() || ETIQUETA_TIPO_GARANTIA[f.tipo] || 'Sin nombre',
    documento: f.doc_numero,
    telefono: f.telefono,
    email: f.email,
    // La normalización va acá y no en la pantalla: la regla de dónde termina el
    // código de área es de negocio, se prueba sin navegador, y el día que haya
    // un segundo lugar que arme un wa.me tiene que dar el mismo número.
    whatsapp: normalizarAr(f.telefono),
    tipo: f.tipo,
    tipoTexto: ETIQUETA_TIPO_GARANTIA[f.tipo] ?? f.tipo,
    detalle: f.detalle,
    venceEl,
    vencida: venceEl !== null && venceEl < hoy,
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

      revisarEl,
      revisionMemoria: consultado ? (f.bcra_detalle?.revisionMemoria ?? null) : null,
      // Comparación de dos textos AAAA-MM-DD, que ordenan igual que las fechas
      // que representan. Sin `Date` de por medio no hay zona que corra el día.
      revisionVencida: revisarEl !== null && revisarEl <= hoy,

      cheques: f.bcra_cheques ?? null,
      chequesError: consultado ? (f.historial?.chequesError ?? null) : null,

      historial: {
        consultas: Number(f.historial?.consultas ?? 0),
        primera: f.historial?.primera ?? null,
        ultima: f.historial?.ultima ?? null,
      },
    },

    documentos,
    faltan,
    legajoCompleto: faltan.length === 0,
  };
}

/** Fechas en dd/mm/aaaa, también dentro de una frase que arma el back. */
function ddmmaaaa(iso: string): string {
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function esDuplicado(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && 'code' in err &&
    (err as { code: string }).code === '23505'
  );
}
