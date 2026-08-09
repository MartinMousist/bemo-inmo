import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { PlantillasService, type FormatoContenido } from './plantillas.service';
import { htmlATexto } from './plantillas.html';
import { sanitizarDocumento } from './plantillas.sanitizar';
import {
  armarMailto, armarWhatsapp, LIMITE_MAILTO_URL, LIMITE_WA_TEXTO,
  type CanalEnvio, type Preparado,
} from './envio.motor';

/**
 * Los documentos que salieron del sistema.
 *
 * Hasta la migración 020 el pre-contrato se generaba, se mostraba en pantalla y
 * se evaporaba. «¿Qué le mandamos a esta gente y cuándo?» no tenía respuesta.
 *
 * Dos decisiones que sostienen la feature:
 *
 * **Guardar y mandar son la MISMA llamada.** El envío no se registra desde el
 * front después de abrir el canal: se pide el envío, y ahí adentro se persiste
 * la fila Y se devuelve la URL que el navegador abre. Es lo que hace cierto el
 * «siempre queda guardado» sin depender de que el front se acuerde ni de que la
 * pestaña siga viva.
 *
 * **El texto generado lo produce el motor, acá, en la misma transacción.** No
 * llega en el body. Si el front mandara los dos textos, «qué le cambiaron al
 * modelo» sería lo que el front dice que cambiaron, que es otra cosa.
 */

/** Un documento guardado, como lo devuelve la API. */
export interface DocumentoGuardado {
  id: string;
  contratoId: string;
  plantillaId: string | null;
  plantillaNombre: string;
  plantillaTipo: string;
  titulo: string | null;
  textoGenerado: string;
  textoFinal: string;
  /**
   * Congelado al generar, como `plantillaNombre`.
   *
   * Decide si la vista imprimible usa `v-html` o el `<pre>` monoespaciado. Un
   * papel que salió monoespaciado salió así: convertir la plantilla después no
   * puede cambiar cómo se ve un documento que la otra parte ya recibió.
   */
  formato: FormatoContenido;
  /**
   * El documento dicho en texto plano.
   *
   * Es lo que se mide, lo que baja como `.txt`, lo que se copia y lo que viaja
   * en el cuerpo de un WhatsApp. Va en la respuesta para que el front no tenga
   * una segunda implementación de `htmlATexto()`: la misma regla que ya está
   * escrita en `PanelDocumentos.vue` sobre no copiar el límite del envío.
   */
  textoPlano: string;
  /** Derivado: `texto_final <> texto_generado`. La UI lo muestra como «editado». */
  editado: boolean;
  faltantes: string[];
  generadoPor: string | null;
  primerEnvioEl: string | null;
  createdAt: string;
  /** Congelado desde el primer envío. Es la misma regla del ajuste confirmado. */
  bloqueado: boolean;
  envios: EnvioGuardado[];
  /** Para la carátula, el asunto y el membrete de la vista imprimible. */
  contrato: { etiqueta: string; direccion: string; inmobiliaria: string };
}

export interface EnvioGuardado {
  id: string;
  canal: CanalEnvio;
  destino: string | null;
  modo: string | null;
  caracteres: number | null;
  abiertoEl: string;
  abiertoPor: string | null;
  nota: string | null;
}

interface FilaDoc {
  id: string;
  contrato_id: string;
  plantilla_id: string | null;
  plantilla_nombre: string;
  plantilla_tipo: string;
  titulo: string | null;
  texto_generado: string;
  texto_final: string;
  formato: FormatoContenido;
  faltantes: string[];
  generado_por_nombre: string | null;
  primer_envio_el: Date | null;
  created_at: Date;
  etiqueta: string;
  direccion: string;
  inmobiliaria: string;
}

/** Los canales que sí abren algo. El resto se registra sin URL. */
const CANALES_CON_URL: CanalEnvio[] = ['whatsapp', 'email'];

@Injectable()
export class DocumentosService {
  constructor(
    private readonly db: DbService,
    private readonly plantillas: PlantillasService,
  ) {}

  /**
   * Genera el documento con el motor y lo guarda.
   *
   * `textoFinal` es opcional: guardar sin editar deja los dos textos iguales, que
   * es la forma de decir «salió el modelo tal cual».
   */
  async crear(
    tenantId: string,
    usuarioId: string,
    dto: { contratoId: string; plantillaId: string; textoFinal?: string; titulo?: string },
  ): Promise<DocumentoGuardado> {
    return this.db.withTenant(tenantId, async (ej) => {
      const doc = await this.plantillas.generarCon(ej, dto.plantillaId, dto.contratoId);

      // Lo que llega editado desde afuera pasa por el sanitizador igual que la
      // plantilla: `POST /documentos` acepta `textoFinal` en el body y ese
      // texto termina en un `v-html`.
      const final = dto.textoFinal === undefined
        ? doc.texto
        : (doc.formato === 'html' ? sanitizarDocumento(dto.textoFinal) : dto.textoFinal);

      const { rows } = await ej.query<{ id: string }>(
        `INSERT INTO documento_generado (
           tenant_id, contrato_id, plantilla_id, plantilla_nombre, plantilla_tipo,
           titulo, texto_generado, texto_final, formato, faltantes, generado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          tenantId, dto.contratoId, dto.plantillaId,
          doc.plantilla.nombre, doc.plantilla.tipo,
          dto.titulo ?? doc.plantilla.nombre,
          doc.texto,
          // Sin edición, los dos son el mismo texto. La diferencia es el dato.
          final,
          // Congelado, como el nombre de la plantilla.
          doc.formato,
          doc.faltantes,
          usuarioId,
        ],
      );

      return this.leer(ej, rows[0].id);
    });
  }

  /**
   * El pre-contrato de un contrato recién creado.
   *
   * Lo pidió el dueño y lo repitió: **el texto tiene que estar cargado cuando se
   * crea el contrato**, no detrás de un botón «generar». Entrás a la ficha del
   * contrato nuevo y el pre-contrato ya está, listo para editar, imprimir o
   * mandar.
   *
   * Devuelve `null` en vez de tirar, siempre. Es la regla que ordena todo lo de
   * abajo: **que un pre-contrato no se pueda armar NO puede impedir guardar un
   * contrato**. Un contrato es el hecho legal; el documento es una comodidad, y
   * una comodidad que voltea la operación deja de serlo. Por eso los tres casos
   * de borde terminan igual —el contrato queda creado— y la ficha explica qué
   * falta:
   *
   * · **No hay plantilla de ese tipo**: la inmobiliaria nunca apretó «Traer las
   *   base» o la borró. Se saltea; la ficha lo dice y ofrece el atajo.
   * · **Faltan variables**: se genera IGUAL y los huecos viajan en `faltantes`.
   *   Un pre-contrato con lugares para completar a mano es lo normal —hay datos
   *   que se llenan en la mesa—; uno que no existe, no.
   * · **Ya hay uno**: se devuelve el que está. Dos pre-contratos del mismo
   *   contrato es la pregunta «¿cuál firmamos?», que no tiene buena respuesta.
   */
  async generarPreContrato(
    tenantId: string,
    usuarioId: string,
    contratoId: string,
  ): Promise<DocumentoGuardado | null> {
    const plantillaId = await this.db.withTenant(tenantId, async (ej) => {
      // Si ya hay uno, no se hace nada más: ni se busca plantilla ni se genera.
      const { rows: yaHay } = await ej.query<{ id: string }>(
        `SELECT id FROM documento_generado
          WHERE contrato_id = $1 AND plantilla_tipo = 'pre_contrato_alquiler'
          ORDER BY created_at LIMIT 1`,
        [contratoId],
      );
      if (yaHay.length) return { existente: yaHay[0].id, plantilla: null };

      const { rows } = await ej.query<{ id: string }>(
        `SELECT id FROM plantilla_doc
          WHERE tipo = 'pre_contrato_alquiler' AND activa
          ORDER BY nombre LIMIT 1`,
      );
      return { existente: null, plantilla: rows[0]?.id ?? null };
    });

    if (plantillaId.existente) {
      return this.obtener(tenantId, plantillaId.existente);
    }
    if (!plantillaId.plantilla) return null;

    return this.crear(tenantId, usuarioId, {
      contratoId,
      plantillaId: plantillaId.plantilla,
    });
  }

  async listarPorContrato(tenantId: string, contratoId: string): Promise<DocumentoGuardado[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ id: string }>(
        `SELECT id FROM documento_generado
          WHERE contrato_id = $1 ORDER BY created_at DESC`,
        [contratoId],
      );
      const salida: DocumentoGuardado[] = [];
      for (const r of rows) salida.push(await this.leer(ej, r.id));
      return salida;
    });
  }

  async obtener(tenantId: string, id: string): Promise<DocumentoGuardado> {
    return this.db.withTenant(tenantId, (ej) => this.leer(ej, id));
  }

  /**
   * Edita el texto o el título.
   *
   * ⚠️ Con `coalesce`: un PUT que trae sólo el texto NO puede borrar el título.
   * Es la trampa que en este repo ya costó una vez —cargar titulares borraba
   * número, ambientes y metros— y está anotada en `docs/CONTINUAR.md`.
   *
   * Después del primer envío el texto queda congelado. Lo hace cumplir un
   * trigger de la base, no este método: una regla de inmutabilidad que vive sólo
   * en TypeScript se esquiva con un script de mantenimiento. Acá se traduce el
   * error de la base a un 409 con la salida escrita.
   */
  async actualizar(
    tenantId: string,
    id: string,
    dto: { textoFinal?: string; titulo?: string },
  ): Promise<DocumentoGuardado> {
    return this.db.withTenant(tenantId, async (ej) => {
      // El formato lo decide la fila, no el body: es lo que se congeló al
      // generar. Un PUT no puede convertir un documento viejo a HTML.
      const { rows: actual } = await ej.query<{ formato: FormatoContenido }>(
        'SELECT formato FROM documento_generado WHERE id = $1', [id],
      );
      if (!actual.length) throw AppError.notFound('No se encontró ese documento.');

      const texto = dto.textoFinal === undefined
        ? null
        : (actual[0].formato === 'html' ? sanitizarDocumento(dto.textoFinal) : dto.textoFinal);

      let rowCount: number | null;
      try {
        ({ rowCount } = await ej.query(
          `UPDATE documento_generado
              SET texto_final = coalesce($2, texto_final),
                  titulo      = coalesce($3, titulo)
            WHERE id = $1`,
          [id, texto, dto.titulo ?? null],
        ));
      } catch (err) {
        throw this.traducirCongelado(err);
      }
      if (!rowCount) throw AppError.notFound('No se encontró ese documento.');
      return this.leer(ej, id);
    });
  }

  /**
   * Borra un documento que nunca salió.
   *
   * Uno que ya se mandó no se borra: es la constancia de qué papel recibió la
   * otra parte, y hacerla desaparecer del historial es justo lo que el historial
   * viene a impedir.
   */
  async borrar(tenantId: string, id: string): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ primer_envio_el: Date | null }>(
        'SELECT primer_envio_el FROM documento_generado WHERE id = $1',
        [id],
      );
      if (!rows.length) throw AppError.notFound('No se encontró ese documento.');
      if (rows[0].primer_envio_el) {
        throw new AppError(
          409,
          ErrorCode.ESTADO_INVALIDO,
          'Este documento ya se mandó: queda en el historial como constancia de ' +
            'qué recibió la otra parte. Se puede generar uno nuevo, pero éste no se borra.',
          'Conflict',
        );
      }
      await ej.query('DELETE FROM documento_generado WHERE id = $1', [id]);
    });
  }

  /**
   * Arma el enlace SIN registrar nada.
   *
   * Existe para que la pantalla pueda decir el motivo **antes** de que alguien
   * apriete: cuántos caracteres tiene, cuál es el límite del canal, a qué número
   * va a ir y que no se puede saber si ese número es un celular. Un «se abrió
   * WhatsApp» anotado en el historial de un documento que nadie mandó sería la
   * misma mentira que la columna `enviado_el` que esta feature no tiene.
   */
  async preparar(
    tenantId: string,
    id: string,
    canal: 'whatsapp' | 'email',
    destino?: string,
  ): Promise<Preparado> {
    const doc = await this.obtener(tenantId, id);
    return this.armar(doc, canal, destino);
  }

  /**
   * Registra que se abrió un canal, y devuelve la URL para abrirlo.
   *
   * El orden importa: primero se guarda, después el front abre. Al revés, una
   * pestaña que se cierra en el medio deja un documento mandado sin rastro.
   */
  async registrarEnvio(
    tenantId: string,
    id: string,
    usuarioId: string,
    dto: { canal: CanalEnvio; destino?: string; nota?: string },
  ): Promise<{ envio: EnvioGuardado; preparado: Preparado | null; documento: DocumentoGuardado }> {
    const doc = await this.obtener(tenantId, id);

    let preparado: Preparado | null = null;
    if (CANALES_CON_URL.includes(dto.canal)) {
      preparado = this.armar(doc, dto.canal as 'whatsapp' | 'email', dto.destino);
      if (!preparado.url) {
        // No se registra un envío que no se pudo abrir: el historial diría que
        // salió algo que no salió.
        throw new AppError(
          422,
          ErrorCode.VALIDATION_FAILED,
          preparado.motivo ?? 'No se pudo armar el enlace para ese destinatario.',
          'Unprocessable Entity',
        );
      }
    }

    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ id: string }>(
        `INSERT INTO documento_envio (
           tenant_id, documento_id, canal, destino, url_abierta, modo, caracteres,
           abierto_por, nota)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          tenantId, id, dto.canal,
          preparado?.destino ?? null,
          preparado?.url ?? null,
          preparado?.modo ?? null,
          preparado?.caracteres ?? null,
          usuarioId,
          dto.nota ?? null,
        ],
      );

      const documento = await this.leer(ej, id);
      const envio = documento.envios.find((e) => e.id === rows[0].id)!;
      return { envio, preparado, documento };
    });
  }

  /** Los límites de cada canal, con su fuente. La pantalla los muestra. */
  limites() {
    return {
      whatsapp: {
        limite: LIMITE_WA_TEXTO,
        que: 'caracteres del mensaje',
        fuente: 'WhatsApp corta el cuerpo del mensaje en 4.096 caracteres.',
      },
      email: {
        limite: LIMITE_MAILTO_URL,
        que: 'caracteres de la URL, ya codificada',
        fuente:
          'Outlook clásico y el shell de Windows cortan un mailto: a los 2.048 ' +
          'caracteres. Codificar el texto lo agranda alrededor de una vez y media.',
      },
    };
  }

  /**
   * El documento dicho en texto plano.
   *
   * Existe como endpoint —`GET /documentos/:id/texto`— para que el front no
   * reimplemente `htmlATexto()`. Es la misma regla que ya está escrita en
   * `PanelDocumentos.vue`: el límite del envío vive en el motor y no copiado en
   * el front, y esta proyección es lo que ese límite mide.
   */
  async texto(tenantId: string, id: string): Promise<{ texto: string; caracteres: number }> {
    const doc = await this.obtener(tenantId, id);
    return { texto: doc.textoPlano, caracteres: doc.textoPlano.length };
  }

  // ── Interno ────────────────────────────────────────────────────────────────

  private armar(
    doc: DocumentoGuardado,
    canal: 'whatsapp' | 'email',
    destino?: string,
  ): Preparado {
    const entrada = {
      // ⚠️ `textoPlano` y NO `textoFinal`. `envio.motor.ts` decide `completo` vs
      // `adjunto` midiendo `texto.length`: con las etiquetas adentro, un
      // pre-contrato de 2.000 caracteres mide 6.000 y TODO documento pasaría a
      // «adjunto» con un motivo que cita un número que no es. Nada falla, sólo
      // empieza a mentir el cartel — y encima el mensaje de WhatsApp llevaría
      // el HTML crudo, que del otro lado se lee con las etiquetas a la vista.
      texto: doc.textoPlano,
      titulo: doc.titulo ?? doc.plantillaNombre,
      referencia: doc.contrato.direccion,
    };
    return canal === 'whatsapp'
      ? armarWhatsapp({ ...entrada, telefono: destino })
      : armarMailto({ ...entrada, email: destino });
  }

  private async leer(ej: Ejecutor, id: string): Promise<DocumentoGuardado> {
    const { rows } = await ej.query<FilaDoc>(
      `SELECT d.id, d.contrato_id, d.plantilla_id, d.plantilla_nombre, d.plantilla_tipo,
              d.titulo, d.texto_generado, d.texto_final, d.formato, d.faltantes,
              d.primer_envio_el, d.created_at,
              u.nombre AS generado_por_nombre,
              'PROP-' || lpad(pr.codigo::text, 4, '0') AS etiqueta,
              concat_ws(', ',
                nullif(concat_ws(' ', pr.calle, pr.numero), ''),
                pr.localidad, pr.provincia) AS direccion,
              t.nombre AS inmobiliaria
         FROM documento_generado d
         JOIN contrato_alquiler c ON c.id = d.contrato_id
         JOIN propiedad pr ON pr.id = c.propiedad_id
         JOIN tenant t ON t.id = d.tenant_id
         LEFT JOIN usuario u ON u.id = d.generado_por
        WHERE d.id = $1`,
      [id],
    );
    if (!rows.length) throw AppError.notFound('No se encontró ese documento.');
    const r = rows[0];

    const { rows: envios } = await ej.query<{
      id: string; canal: CanalEnvio; destino: string | null; modo: string | null;
      caracteres: number | null; abierto_el: Date; nota: string | null;
      abierto_por_nombre: string | null;
    }>(
      `SELECT e.id, e.canal, e.destino, e.modo, e.caracteres, e.abierto_el, e.nota,
              u.nombre AS abierto_por_nombre
         FROM documento_envio e
         LEFT JOIN usuario u ON u.id = e.abierto_por
        WHERE e.documento_id = $1
        ORDER BY e.abierto_el DESC`,
      [id],
    );

    return {
      id: r.id,
      contratoId: r.contrato_id,
      plantillaId: r.plantilla_id,
      plantillaNombre: r.plantilla_nombre,
      plantillaTipo: r.plantilla_tipo,
      titulo: r.titulo,
      textoGenerado: r.texto_generado,
      textoFinal: r.texto_final,
      formato: r.formato,
      textoPlano: r.formato === 'html' ? htmlATexto(r.texto_final) : r.texto_final,
      editado: r.texto_final !== r.texto_generado,
      faltantes: r.faltantes ?? [],
      generadoPor: r.generado_por_nombre,
      primerEnvioEl: r.primer_envio_el ? r.primer_envio_el.toISOString() : null,
      createdAt: r.created_at.toISOString(),
      bloqueado: r.primer_envio_el !== null,
      envios: envios.map((e) => ({
        id: e.id,
        canal: e.canal,
        destino: e.destino,
        modo: e.modo,
        caracteres: e.caracteres,
        abiertoEl: e.abierto_el.toISOString(),
        abiertoPor: e.abierto_por_nombre,
        nota: e.nota,
      })),
      contrato: { etiqueta: r.etiqueta, direccion: r.direccion, inmobiliaria: r.inmobiliaria },
    };
  }

  /**
   * El trigger `documento_congelado` levanta un `check_violation` (SQLSTATE
   * 23514) con el texto ya redactado. Se traduce a 409 —«conflicto con el estado
   * actual», que es literalmente esto— en vez de dejar salir un 500.
   */
  private traducirCongelado(err: unknown): unknown {
    const code = typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
    if (code !== '23514') return err;

    const mensaje = typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : '';
    if (!mensaje.includes('ya se mandó')) return err;

    return new AppError(409, ErrorCode.ESTADO_INVALIDO, mensaje, 'Conflict');
  }
}
