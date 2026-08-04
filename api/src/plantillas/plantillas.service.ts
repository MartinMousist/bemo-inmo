import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { renderizar, variablesDe, type Contexto } from './plantillas.motor';
import { PLANTILLAS_POR_DEFECTO } from './plantillas.defecto';

export interface Plantilla {
  id: string;
  tipo: string;
  nombre: string;
  contenido: string;
  activa: boolean;
  variables: string[];
}

export interface Documento {
  texto: string;
  faltantes: string[];
  plantilla: { id: string; nombre: string };
}

@Injectable()
export class PlantillasService {
  constructor(private readonly db: DbService) {}

  async listar(tenantId: string): Promise<Plantilla[]> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        id: string; tipo: string; nombre: string; contenido: string; activa: boolean;
      }>('SELECT id, tipo, nombre, contenido, activa FROM plantilla_doc ORDER BY tipo, nombre');

      return rows.map((r) => ({ ...r, variables: variablesDe(r.contenido) }));
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
        `INSERT INTO plantilla_doc (tenant_id, tipo, nombre, contenido)
         SELECT $1, x.tipo, x.nombre, x.contenido
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
          PLANTILLAS_POR_DEFECTO.map((p) => p.contenido),
        ],
      );

      return {
        creadas: creadas.length,
        yaEstaban: PLANTILLAS_POR_DEFECTO.length - creadas.length,
      };
    });
  }

  async guardar(
    tenantId: string,
    dto: { id?: string; tipo: string; nombre: string; contenido: string },
  ): Promise<Plantilla> {
    return this.db.withTenant(tenantId, async (ej) => {
      const id = dto.id
        ? (
            await ej.query<{ id: string }>(
              `UPDATE plantilla_doc SET tipo = $2, nombre = $3, contenido = $4
                WHERE id = $1 RETURNING id`,
              [dto.id, dto.tipo, dto.nombre, dto.contenido],
            )
          ).rows[0]?.id
        : (
            await ej.query<{ id: string }>(
              `INSERT INTO plantilla_doc (tenant_id, tipo, nombre, contenido)
               VALUES ($1,$2,$3,$4) RETURNING id`,
              [tenantId, dto.tipo, dto.nombre, dto.contenido],
            )
          ).rows[0].id;

      if (!id) throw AppError.notFound('No se encontró esa plantilla.');

      const { rows } = await ej.query<{
        id: string; tipo: string; nombre: string; contenido: string; activa: boolean;
      }>('SELECT id, tipo, nombre, contenido, activa FROM plantilla_doc WHERE id = $1', [id]);

      return { ...rows[0], variables: variablesDe(rows[0].contenido) };
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
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: p } = await ej.query<{ id: string; nombre: string; contenido: string }>(
        'SELECT id, nombre, contenido FROM plantilla_doc WHERE id = $1',
        [plantillaId],
      );
      if (!p.length) throw AppError.notFound('No se encontró esa plantilla.');

      const ctx = await this.contextoDeContrato(ej, contratoId);
      const r = renderizar(p[0].contenido, ctx);

      return {
        texto: r.texto,
        faltantes: r.faltantes,
        plantilla: { id: p[0].id, nombre: p[0].nombre },
      };
    });
  }

  /** Previsualiza una plantilla contra datos de ejemplo, sin tocar un contrato. */
  previsualizar(contenido: string): Documento {
    const r = renderizar(contenido, EJEMPLO);
    return { texto: r.texto, faltantes: r.faltantes, plantilla: { id: '', nombre: 'Ejemplo' } };
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
              (SELECT json_agg(json_build_object(
                  'nombre', trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')),
                  'documento', pe.doc_numero,
                  'tipoDocumento', upper(coalesce(pe.doc_tipo,'')),
                  'domicilio', pe.domicilio,
                  'porcentaje', cp.porcentaje) ORDER BY cp.porcentaje DESC NULLS LAST)
                 FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
                WHERE cp.contrato_id = c.id AND cp.rol = 'locador') AS locadores,
              (SELECT json_agg(json_build_object(
                  'nombre', trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')),
                  'documento', pe.doc_numero,
                  'tipoDocumento', upper(coalesce(pe.doc_tipo,'')),
                  'domicilio', pe.domicilio))
                 FROM contrato_parte cp JOIN persona pe ON pe.id = cp.persona_id
                WHERE cp.contrato_id = c.id AND cp.rol = 'locatario') AS locatarios,
              (SELECT json_agg(json_build_object(
                  'nombre', trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')),
                  'documento', pe.doc_numero,
                  'domicilio', pe.domicilio))
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
