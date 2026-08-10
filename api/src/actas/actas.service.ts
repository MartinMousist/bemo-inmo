import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { AlmacenamientoService } from '../archivos/almacenamiento.service';
import {
  AMBIENTES_SUGERIDOS, comparar, normalizar,
  type EstadoItem, type ItemActa, type ResultadoComparacion,
} from './actas.motor';
import type {
  CrearActaDto, EditarActaDto, GuardarItemsDto,
} from './actas.dto';

/**
 * El acta de entrega y la de devolución.
 *
 * Es la fuente número uno de conflicto de un alquiler: al devolver el depósito
 * nadie se acuerda de cómo estaba la cocina hace tres años, y hoy eso se
 * resuelve con fotos en el WhatsApp de alguien que capaz ya no trabaja acá.
 *
 * ── Cuatro reglas ──
 *
 * 1. **Firmada es inmutable.** Lo hace cumplir un trigger, no este servicio: un
 *    endpoint nuevo que se olvide del chequeo no puede romper una prueba legal.
 *    Acá el error del motor se traduce a un 409 que se entiende.
 *
 * 2. **La devolución COPIA los ambientes de la entrega.** No es una comodidad:
 *    es lo único que hace comparables a las dos actas. Si cada una se cargara
 *    con su propia lista, el comparativo mostraría dos columnas que no se cruzan
 *    y la feature no serviría para nada.
 *
 * 3. **No se puede firmar un acta vacía.** Un acta sin ambientes no prueba nada
 *    y da una falsa sensación de que el trámite está hecho.
 *
 * 4. **La comparación no vive acá**: está en `actas.motor.ts`, puro, porque es
 *    la regla que decide si se le descuenta algo a alguien del depósito.
 */

export interface FotoActa {
  id: string;
  url: string;
  nombreOriginal: string | null;
  subidaEl: string;
}

export interface ItemGuardado extends ItemActa {
  id: string;
  estado: EstadoItem;
  detalle: string | null;
  orden: number;
  fotosDetalle: FotoActa[];
}

export interface Acta {
  id: string;
  contratoId: string;
  tipo: 'entrega' | 'devolucion';
  tipoTexto: string;
  fecha: string;
  presentes: string | null;
  observaciones: string | null;
  medidores: { luz: string | null; gas: string | null; agua: string | null };
  llavesEntregadas: number | null;
  firmada: boolean;
  firmadaEl: string | null;
  firmadaInquilino: string | null;
  items: ItemGuardado[];
  /** Qué le falta para poder firmarse. Vacío = se puede. */
  pendientes: string[];
}

export interface EstadoActas {
  entrega: Acta | null;
  devolucion: Acta | null;
  /** Sólo cuando existen las dos. Es la razón de ser de todo esto. */
  comparacion: ResultadoComparacion | null;
  ambientesSugeridos: string[];
}

const ETIQUETA_TIPO = { entrega: 'Acta de entrega', devolucion: 'Acta de devolución' };

@Injectable()
export class ActasService {
  constructor(
    private readonly db: DbService,
    private readonly almacen: AlmacenamientoService,
  ) {}

  async leer(tenantId: string, contratoId: string): Promise<EstadoActas> {
    return this.db.withTenant(tenantId, async (ej) => {
      const actas = await this.leerDe(ej, contratoId);
      const entrega = actas.find((a) => a.tipo === 'entrega') ?? null;
      const devolucion = actas.find((a) => a.tipo === 'devolucion') ?? null;

      return {
        entrega,
        devolucion,
        // Sin las dos no hay nada que comparar, y devolver una comparación de
        // una sola contra el vacío diría que todo «no se revisó».
        comparacion:
          entrega && devolucion ? comparar(entrega.items, devolucion.items) : null,
        ambientesSugeridos: AMBIENTES_SUGERIDOS,
      };
    });
  }

  async crear(
    tenantId: string,
    contratoId: string,
    usuarioId: string,
    dto: CrearActaDto,
  ): Promise<EstadoActas> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        'SELECT 1 FROM contrato_alquiler WHERE id = $1',
        [contratoId],
      );
      if (!rowCount) throw AppError.notFound('No se encontró ese contrato.');

      // Los ambientes de la devolución NO llegan del body: se copian de la
      // entrega. Ver la regla 2 del comentario de arriba.
      let items = dto.items ?? [];
      if (dto.tipo === 'devolucion') {
        const { rows } = await ej.query<{ ambiente: string }>(
          `SELECT i.ambiente
             FROM acta_item i JOIN acta a ON a.id = i.acta_id
            WHERE a.contrato_id = $1 AND a.tipo = 'entrega'
            ORDER BY i.orden`,
          [contratoId],
        );
        if (!rows.length) {
          throw new AppError(
            422, ErrorCode.VALIDATION_FAILED,
            'Para hacer el acta de devolución primero tiene que existir la de entrega: ' +
              'sin ella no hay con qué comparar el estado en que volvió la unidad.',
            'Unprocessable Entity',
          );
        }
        // Arrancan todos en «bueno» y se corrigen recorriendo la casa. Copiar el
        // estado de la entrega sería peor: quien recorre confirmaría sin mirar.
        items = rows.map((r) => ({ ambiente: r.ambiente, estado: 'bueno' }));
      }

      let actaId: string;
      try {
        const { rows } = await ej.query<{ id: string }>(
          `INSERT INTO acta (tenant_id, contrato_id, tipo, fecha, creada_por)
           VALUES ($1, $2, $3, coalesce($4::date, current_date), $5)
           RETURNING id`,
          [tenantId, contratoId, dto.tipo, dto.fecha ?? null, usuarioId],
        );
        actaId = rows[0].id;
      } catch (err) {
        if (codigo(err) === '23505') {
          throw new AppError(
            409, ErrorCode.OPERACION_DUPLICADA,
            `Este contrato ya tiene su ${ETIQUETA_TIPO[dto.tipo as 'entrega'].toLowerCase()}.`,
            'Conflict',
          );
        }
        throw err;
      }

      await this.escribirItems(ej, tenantId, actaId, items);
    });

    return this.leer(tenantId, contratoId);
  }

  async editar(tenantId: string, actaId: string, dto: EditarActaDto): Promise<EstadoActas> {
    const contratoId = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ contrato_id: string }>(
        `UPDATE acta SET
           fecha         = coalesce($2::date, fecha),
           presentes     = coalesce($3, presentes),
           observaciones = coalesce($4, observaciones),
           medidor_luz   = coalesce($5, medidor_luz),
           medidor_gas   = coalesce($6, medidor_gas),
           medidor_agua  = coalesce($7, medidor_agua),
           llaves_entregadas = coalesce($8, llaves_entregadas)
         WHERE id = $1 RETURNING contrato_id`,
        [
          actaId, dto.fecha ?? null, dto.presentes ?? null, dto.observaciones ?? null,
          dto.medidorLuz ?? null, dto.medidorGas ?? null, dto.medidorAgua ?? null,
          dto.llavesEntregadas ?? null,
        ],
      ).catch(traducirFirmada);
      if (!rows.length) throw AppError.notFound('No se encontró esa acta.');
      return rows[0].contrato_id;
    });

    return this.leer(tenantId, contratoId);
  }

  /** Reemplaza los ambientes enteros. Las fotos de los que sobreviven se conservan. */
  async guardarItems(
    tenantId: string,
    actaId: string,
    dto: GuardarItemsDto,
  ): Promise<EstadoActas> {
    const contratoId = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ contrato_id: string }>(
        'SELECT contrato_id FROM acta WHERE id = $1',
        [actaId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa acta.');

      // Se borra sólo lo que ya no está, por nombre normalizado: un DELETE de
      // todo y volver a insertar se llevaría las fotos por CASCADE, que es
      // exactamente lo que no se puede perder.
      const quedan = dto.items.map((i) => normalizar(i.ambiente));
      await ej.query(
        `DELETE FROM acta_item
          WHERE acta_id = $1
            AND lower(trim(ambiente)) <> ALL($2::text[])`,
        [actaId, quedan],
      ).catch(traducirFirmada);

      await this.escribirItems(ej, tenantId, actaId, dto.items);
      return rows[0].contrato_id;
    });

    return this.leer(tenantId, contratoId);
  }

  /**
   * Firmar. Es irreversible: desde acá el acta no se toca más.
   *
   * Se comprueba que tenga ambientes antes: un acta vacía firmada no prueba
   * nada y encima da la sensación de que el trámite está hecho.
   */
  async firmar(
    tenantId: string,
    actaId: string,
    usuarioId: string,
    firmadaInquilino: string,
  ): Promise<EstadoActas> {
    const contratoId = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ contrato_id: string; firmada_el: Date | null; n: string }>(
        `SELECT a.contrato_id, a.firmada_el,
                (SELECT count(*)::text FROM acta_item i WHERE i.acta_id = a.id) AS n
           FROM acta a WHERE a.id = $1`,
        [actaId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa acta.');
      if (rows[0].firmada_el) {
        throw new AppError(
          409, ErrorCode.YA_RENDIDO,
          'Esa acta ya está firmada.', 'Conflict',
        );
      }
      if (Number(rows[0].n) === 0) {
        throw new AppError(
          422, ErrorCode.VALIDATION_FAILED,
          'No se puede firmar un acta sin ambientes: no probaría nada.',
          'Unprocessable Entity',
        );
      }

      await ej.query(
        `UPDATE acta SET firmada_el = now(), firmada_por = $2, firmada_inquilino = $3
          WHERE id = $1`,
        [actaId, usuarioId, firmadaInquilino],
      );
      return rows[0].contrato_id;
    });

    return this.leer(tenantId, contratoId);
  }

  async subirFoto(
    tenantId: string,
    itemId: string,
    datos: Buffer,
    nombreOriginal: string | undefined,
    usuarioId: string,
  ): Promise<EstadoActas> {
    // Se valida ANTES de subir: un archivo huérfano en el bucket no lo limpia
    // nadie. Es la misma secuencia que las fotos de una propiedad.
    const { contratoId, firmada } = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ contrato_id: string; firmada_el: Date | null }>(
        `SELECT a.contrato_id, a.firmada_el
           FROM acta_item i JOIN acta a ON a.id = i.acta_id
          WHERE i.id = $1`,
        [itemId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró ese ambiente.');
      return { contratoId: rows[0].contrato_id, firmada: rows[0].firmada_el !== null };
    });

    if (firmada) {
      throw new AppError(
        409, ErrorCode.YA_RENDIDO,
        'El acta ya está firmada: no se le pueden agregar fotos.', 'Conflict',
      );
    }

    const subido = await this.almacen.subirImagen(
      tenantId, `actas/${itemId}`, datos, nombreOriginal,
    );

    try {
      await this.db.withTenant(tenantId, (ej) =>
        ej.query(
          `INSERT INTO acta_foto (tenant_id, acta_item_id, url, nombre_original, subida_por)
           VALUES ($1,$2,$3,$4,$5)`,
          [tenantId, itemId, subido.url, nombreOriginal ?? null, usuarioId],
        ),
      );
    } catch (err) {
      await this.almacen.borrar(subido.clave);
      throw err;
    }

    return this.leer(tenantId, contratoId);
  }

  async borrarFoto(tenantId: string, fotoId: string): Promise<EstadoActas> {
    const { contratoId, url } = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ url: string; contrato_id: string }>(
        `SELECT f.url, a.contrato_id
           FROM acta_foto f
           JOIN acta_item i ON i.id = f.acta_item_id
           JOIN acta a ON a.id = i.acta_id
          WHERE f.id = $1`,
        [fotoId],
      );
      if (!rows.length) throw AppError.notFound('No se encontró esa foto.');

      await ej.query('DELETE FROM acta_foto WHERE id = $1', [fotoId]).catch(traducirFirmada);
      return { contratoId: rows[0].contrato_id, url: rows[0].url };
    });

    const clave = this.almacen.claveDeUrl(url);
    if (clave) await this.almacen.borrar(clave);

    return this.leer(tenantId, contratoId);
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private async escribirItems(
    ej: Ejecutor,
    tenantId: string,
    actaId: string,
    items: Array<{ ambiente: string; estado: string; detalle?: string }>,
  ): Promise<void> {
    if (!items.length) return;

    // Un INSERT en lote con `ON CONFLICT` no sirve: no hay índice único por
    // (acta, ambiente) —el ambiente es texto libre y admite mayúsculas—, así que
    // se resuelve leyendo lo que hay y decidiendo por nombre normalizado.
    const { rows: actuales } = await ej.query<{ id: string; ambiente: string }>(
      'SELECT id, ambiente FROM acta_item WHERE acta_id = $1',
      [actaId],
    );
    const porNombre = new Map(actuales.map((a) => [normalizar(a.ambiente), a.id]));

    for (const [i, it] of items.entries()) {
      const existente = porNombre.get(normalizar(it.ambiente));
      if (existente) {
        await ej.query(
          'UPDATE acta_item SET ambiente = $2, estado = $3, detalle = $4, orden = $5 WHERE id = $1',
          [existente, it.ambiente.trim(), it.estado, it.detalle ?? null, i],
        ).catch(traducirFirmada);
      } else {
        await ej.query(
          `INSERT INTO acta_item (tenant_id, acta_id, ambiente, estado, detalle, orden)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tenantId, actaId, it.ambiente.trim(), it.estado, it.detalle ?? null, i],
        ).catch(traducirFirmada);
      }
    }
  }

  private async leerDe(ej: Ejecutor, contratoId: string): Promise<Acta[]> {
    const { rows } = await ej.query<FilaActa>(
      `SELECT a.id, a.contrato_id, a.tipo, a.fecha, a.presentes, a.observaciones,
              a.medidor_luz, a.medidor_gas, a.medidor_agua, a.llaves_entregadas,
              a.firmada_el, a.firmada_inquilino,
              (SELECT json_agg(json_build_object(
                  'id', i.id, 'ambiente', i.ambiente, 'estado', i.estado,
                  'detalle', i.detalle, 'orden', i.orden,
                  'fotos', (SELECT json_agg(json_build_object(
                              'id', f.id, 'url', f.url,
                              'nombreOriginal', f.nombre_original,
                              'subidaEl', f.created_at) ORDER BY f.created_at)
                              FROM acta_foto f WHERE f.acta_item_id = i.id))
                 ORDER BY i.orden)
                 FROM acta_item i WHERE i.acta_id = a.id) AS items
         FROM acta a
        WHERE a.contrato_id = $1
        ORDER BY a.tipo`,
      [contratoId],
    );

    return rows.map(aActa);
  }
}

interface FilaActa {
  id: string;
  contrato_id: string;
  tipo: 'entrega' | 'devolucion';
  fecha: string;
  presentes: string | null;
  observaciones: string | null;
  medidor_luz: string | null;
  medidor_gas: string | null;
  medidor_agua: string | null;
  llaves_entregadas: number | null;
  firmada_el: Date | null;
  firmada_inquilino: string | null;
  items: Array<{
    id: string; ambiente: string; estado: EstadoItem; detalle: string | null;
    orden: number; fotos: FotoActa[] | null;
  }> | null;
}

function aActa(f: FilaActa): Acta {
  const items: ItemGuardado[] = (f.items ?? []).map((i) => ({
    id: i.id,
    ambiente: i.ambiente,
    estado: i.estado,
    detalle: i.detalle,
    orden: i.orden,
    fotos: (i.fotos ?? []).length,
    fotosDetalle: (i.fotos ?? []).map((x) => ({
      ...x,
      subidaEl: new Date(x.subidaEl).toISOString(),
    })),
  }));

  const pendientes: string[] = [];
  if (!items.length) pendientes.push('Todavía no hay ambientes cargados.');
  const sinFoto = items.filter((i) => i.fotos === 0);
  if (items.length && sinFoto.length) {
    pendientes.push(
      `${sinFoto.length === 1 ? 'Un ambiente no tiene' : `${sinFoto.length} ambientes no tienen`} ` +
        'foto: es lo que después no se puede discutir.',
    );
  }

  return {
    id: f.id,
    contratoId: f.contrato_id,
    tipo: f.tipo,
    tipoTexto: ETIQUETA_TIPO[f.tipo],
    // `date` de Postgres: se recorta el texto, no pasa por `Date`.
    fecha: String(f.fecha).slice(0, 10),
    presentes: f.presentes,
    observaciones: f.observaciones,
    medidores: { luz: f.medidor_luz, gas: f.medidor_gas, agua: f.medidor_agua },
    llavesEntregadas: f.llaves_entregadas,
    firmada: f.firmada_el !== null,
    firmadaEl: f.firmada_el?.toISOString() ?? null,
    firmadaInquilino: f.firmada_inquilino,
    items,
    pendientes: f.firmada_el ? [] : pendientes,
  };
}

/**
 * El trigger de la 024 corta con SQLSTATE 'BE002', el mismo del gasto rendido y
 * la liquidación cerrada. Se traduce acá a un 409 con `YA_RENDIDO`, que el front
 * ya sabe leer: un error de Postgres crudo en pantalla no le dice nada a nadie.
 */
function traducirFirmada(err: unknown): never {
  if (codigo(err) === 'BE002') {
    throw new AppError(
      409, ErrorCode.YA_RENDIDO,
      'El acta ya está firmada y no se puede modificar. Lo que aparezca después va ' +
        'como observación nueva, con su fecha.',
      'Conflict',
    );
  }
  throw err;
}

function codigo(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code: string }).code
    : undefined;
}
