import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { AlmacenamientoService } from '../archivos/almacenamiento.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { loadEnv } from '../config/env';

/**
 * Retención de datos personales (etapa 17.2, Ley 25.326).
 *
 * ── El principio ──
 *
 * La ley no fija plazos: fija que el dato no se guarda más allá de la finalidad
 * que justificó juntarlo. El legajo de un garante existe para decidir si se lo
 * acepta en UN contrato; tres años después de que ese contrato terminó, la foto
 * de su DNI y sus tres recibos de sueldo no cumplen ninguna finalidad y siguen
 * siendo un riesgo —para él, no para nosotros—.
 *
 * ── Por qué NO purga sola ──
 *
 * Porque borra prueba. Un legajo es lo que respalda por qué se aceptó a ese
 * garante, y un proceso automático que lo borra a las tres de la mañana deja a
 * la inmobiliaria sin nada que mostrar si eso se discute justo esa semana. Acá
 * el sistema **avisa qué está vencido y borra cuando alguien lo pide**, y esa
 * persona queda registrada.
 *
 * La excepción es el desglose del BCRA: no es prueba de nada que el veredicto
 * no diga, es dato bancario de un tercero, y se puede purgar sin dejar hueco
 * —el veredicto se conserva entero—.
 */

export interface EstadoRetencion {
  /** Los plazos configurados, para que la pantalla los pueda decir. */
  aniosLegajos: number;
  mesesBcra: number;
  legajosVencidos: {
    documentos: number;
    garantes: number;
    contratoMasViejo: string | null;
  };
  bcraVencidas: number;
}

export interface ResultadoPurga {
  documentosBorrados: number;
  archivosBorrados: number;
  consultasBcraPurgadas: number;
}

@Injectable()
export class RetencionService {
  private readonly logger = new Logger('Retencion');

  constructor(
    private readonly db: DbService,
    private readonly almacen: AlmacenamientoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private plazos() {
    const env = loadEnv();
    return { anios: env.RETENCION_LEGAJOS_ANIOS, meses: env.RETENCION_BCRA_MESES };
  }

  /**
   * Qué hay vencido. No borra nada.
   *
   * «Vencido» es: el contrato que garantizaba terminó —no está vigente ni por
   * iniciar— y su fecha de fin quedó más atrás que el plazo. Un contrato
   * `renovado` cuenta como terminado porque el que sigue es OTRO contrato, con
   * su propio legajo.
   */
  async estado(tenantId: string): Promise<EstadoRetencion> {
    const { anios, meses } = this.plazos();

    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: legajos } = await ej.query<{
        documentos: string; garantes: string; mas_viejo: string | null;
      }>(
        `SELECT count(*)::text AS documentos,
                count(DISTINCT gd.garantia_id)::text AS garantes,
                min(c.fecha_fin)::text AS mas_viejo
           FROM garantia_documento gd
           JOIN garantia g ON g.id = gd.garantia_id
           JOIN contrato_alquiler c ON c.id = g.contrato_id
          WHERE ${CONDICION_LEGAJO_VENCIDO}`,
        [anios],
      );

      const { rows: bcra } = await ej.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM garantia
          WHERE bcra_consultado_el < now() - ($1::int * interval '1 month')
            AND (bcra_detalle ? 'entidades' OR bcra_cheques IS NOT NULL)`,
        [meses],
      );

      return {
        aniosLegajos: anios,
        mesesBcra: meses,
        legajosVencidos: {
          documentos: Number(legajos[0].documentos),
          garantes: Number(legajos[0].garantes),
          // `date` de Postgres: se recorta el texto, no se pasa por `Date`.
          contratoMasViejo: legajos[0].mas_viejo
            ? String(legajos[0].mas_viejo).slice(0, 10)
            : null,
        },
        bcraVencidas: Number(bcra[0].n),
      };
    });
  }

  /**
   * Ejecuta la purga. Queda auditada con quién la pidió y cuánto se borró.
   *
   * Los archivos del bucket se borran DESPUÉS de que la transacción cerró: al
   * revés, un rollback dejaría filas apuntando a objetos que ya no están, que
   * es peor que un objeto huérfano —una fila rota se ve en la pantalla, un
   * objeto de más no lo ve nadie—.
   */
  async purgar(tenantId: string, usuarioId: string, ip?: string): Promise<ResultadoPurga> {
    const { anios, meses } = this.plazos();

    const { claves, documentos, bcra } = await this.db.withTenant(tenantId, async (ej) => {
      const { rows: docs } = await ej.query<{ clave: string | null; url: string | null }>(
        `DELETE FROM garantia_documento gd
          USING garantia g, contrato_alquiler c
          WHERE g.id = gd.garantia_id AND c.id = g.contrato_id
            AND ${CONDICION_LEGAJO_VENCIDO}
        RETURNING gd.clave, gd.url`,
        [anios],
      );

      // Del BCRA se saca el DESGLOSE y se deja el veredicto. `-` sobre jsonb
      // quita la clave si está y no falla si no está.
      //
      // `entidades` es qué bancos le informan deuda, cuánto y con cuántos días
      // de atraso; `probados`, las variantes de CUIT que se derivaron de su
      // DNI; `bcra_cheques`, los cheques rechazados con número y fecha. Nada de
      // eso explica algo que `motivo` no diga, y es dato bancario de alguien
      // que ni siquiera es cliente nuestro.
      //
      // **Se deja dicho que se purgó.** Sin la marca, la ficha simplemente
      // esconde el bloque del desglose y quien la lea dentro de dos años ve un
      // veredicto sin respaldo, sin manera de saber si nunca hubo detalle o si
      // se borró. Eso es la misma regla de honestidad que ya cumple el resto de
      // la app: no se muestra un dato que no es, y no se calla que faltó.
      const { rowCount: purgadas } = await ej.query(
        `UPDATE garantia
            SET bcra_detalle = (bcra_detalle - 'entidades' - 'probados')
                               || jsonb_build_object('desglosePurgadoEl', current_date::text),
                bcra_cheques = NULL
          WHERE bcra_consultado_el < now() - ($1::int * interval '1 month')
            AND (bcra_detalle ? 'entidades' OR bcra_cheques IS NOT NULL)`,
        [meses],
      );

      await this.auditoria.anotar(ej, tenantId, {
        usuarioId,
        accion: 'dato_personal.purgado',
        entidadTipo: 'retencion',
        entidadId: tenantId,
        ip,
        detalle: {
          documentos: docs.length,
          consultasBcra: purgadas ?? 0,
          aniosLegajos: anios,
          mesesBcra: meses,
        },
      });

      return {
        claves: docs.map((d) => d.clave ?? (d.url ? this.almacen.claveDeUrl(d.url) : null)),
        documentos: docs.length,
        bcra: purgadas ?? 0,
      };
    });

    let archivos = 0;
    for (const clave of claves) {
      if (!clave) continue;
      await this.almacen.borrar(clave);
      archivos += 1;
    }

    if (documentos || bcra) {
      this.logger.log(
        `Purga de retención: ${documentos} documentos, ${archivos} archivos, ${bcra} consultas BCRA`,
      );
    }

    return { documentosBorrados: documentos, archivosBorrados: archivos, consultasBcraPurgadas: bcra };
  }
}

/**
 * La condición de «legajo vencido», en un solo lugar.
 *
 * Está compartida entre el conteo y el borrado a propósito: si divergen, la
 * pantalla dice un número y el botón borra otro. `$1` son los años.
 */
const CONDICION_LEGAJO_VENCIDO = `
  c.estado IN ('vencido', 'rescindido', 'renovado')
  AND c.fecha_fin < current_date - ($1::int * interval '1 year')`;
