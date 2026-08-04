import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import { GeocodingService } from './geocoding.service';
import type {
  CrearOperacionDto,
  CrearPropiedadDto,
  EditarOperacionDto,
  EditarPropiedadDto,
  FiltroPropiedadesDto,
  TitularDto,
} from './propiedades.dto';

export interface Operacion {
  id: string;
  tipo: string;
  precio: number | null;
  moneda: string;
  expensas: number | null;
  expensasMoneda: string;
  estado: string;
  exclusividadHasta: string | null;
}

export interface Propiedad {
  id: string;
  codigo: number;
  etiqueta: string;
  direccion: string;
  calle: string;
  numero: string | null;
  piso: string | null;
  depto: string | null;
  localidad: string | null;
  provincia: string | null;
  cp: string | null;
  lat: number | null;
  lng: number | null;
  ubicacionConocida: boolean;
  tipo: string;
  supTotal: number | null;
  supCubierta: number | null;
  ambientes: number | null;
  dormitorios: number | null;
  banos: number | null;
  cocheras: number | null;
  antiguedad: number | null;
  orientacion: string | null;
  estadoConservacion: string | null;
  amenities: string[];
  descripcion: string | null;
  notasInternas: string | null;
  operaciones: Operacion[];
  titulares: Array<{ personaId: string; nombre: string; porcentaje: number }>;
}

@Injectable()
export class PropiedadesService {
  constructor(
    private readonly db: DbService,
    private readonly geo: GeocodingService,
  ) {}

  async listar(tenantId: string, f: FiltroPropiedadesDto): Promise<Pagina<Propiedad>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const q = f.q ? `%${f.q.trim()}%` : null;
      const params = [q, f.tipo ?? null, f.operacion ?? null, f.estado ?? null];

      const donde = `
        WHERE ($1::text IS NULL
               OR p.calle ILIKE $1 OR p.localidad ILIKE $1
               OR p.codigo::text = trim(both '%' from $1))
          AND ($2::text IS NULL OR p.tipo = $2)
          AND ($3::text IS NULL OR EXISTS (
                SELECT 1 FROM operacion o WHERE o.propiedad_id = p.id
                  AND o.tipo = $3 AND o.estado <> 'cerrada'))
          AND ($4::text IS NULL OR EXISTS (
                SELECT 1 FROM operacion o WHERE o.propiedad_id = p.id AND o.estado = $4))`;

      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM propiedad p ${donde}`,
        params,
      );

      const { rows } = await ej.query<FilaPropiedad>(
        `${SELECT_PROPIEDAD} ${donde}
         ORDER BY p.created_at DESC
         LIMIT $5 OFFSET $6`,
        [...params, f.porPagina, offset(f)],
      );

      return armarPagina(rows.map(aPropiedad), Number(conteo[0].total), f);
    });
  }

  async obtener(tenantId: string, id: string): Promise<Propiedad> {
    return this.db.withTenant(tenantId, (ej) => this.leer(ej, id));
  }

  async crear(tenantId: string, dto: CrearPropiedadDto): Promise<Propiedad> {
    // La geocodificación va FUERA de la transacción: es una llamada de red a un
    // tercero y no puede tener una transacción de Postgres abierta esperándola.
    const ubicacion = await this.resolverUbicacion(dto);

    return this.db.withTenant(tenantId, async (ej) => {
      const { rows: cod } = await ej.query<{ codigo: number }>(
        'SELECT app_proximo_codigo_propiedad() AS codigo',
      );

      const { rows } = await ej.query<{ id: string }>(
        `INSERT INTO propiedad (
           tenant_id, codigo, calle, numero, piso, depto, localidad, provincia, cp,
           lat, lng, geocode_fuente, geocode_el,
           tipo, sup_total, sup_cubierta, ambientes, dormitorios, banos, cocheras,
           antiguedad, orientacion, estado_conservacion, amenities,
           descripcion, notas_internas, agente_captador_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                 $19,$20,$21,$22,$23,$24,$25,$26,$27)
         RETURNING id`,
        [
          tenantId, cod[0].codigo,
          dto.calle, dto.numero ?? null, dto.piso ?? null, dto.depto ?? null,
          dto.localidad ?? null, dto.provincia ?? null, dto.cp ?? null,
          ubicacion.lat, ubicacion.lng, ubicacion.fuente, ubicacion.fecha,
          dto.tipo, dto.supTotal ?? null, dto.supCubierta ?? null,
          dto.ambientes ?? null, dto.dormitorios ?? null, dto.banos ?? null,
          dto.cocheras ?? null, dto.antiguedad ?? null,
          dto.orientacion ?? null, dto.estadoConservacion ?? null,
          dto.amenities ?? [],
          dto.descripcion ?? null, dto.notasInternas ?? null,
          dto.agenteCaptadorId ?? null,
        ],
      );

      const id = rows[0].id;
      if (dto.titulares?.length) {
        await this.reemplazarTitulares(ej, tenantId, id, dto.titulares);
      }
      return this.leer(ej, id);
    });
  }

  async editar(
    tenantId: string,
    id: string,
    dto: EditarPropiedadDto,
  ): Promise<Propiedad> {
    const cambiaDireccion =
      dto.calle !== undefined || dto.numero !== undefined || dto.localidad !== undefined;
    const ubicacion =
      dto.lat !== undefined || dto.lng !== undefined || cambiaDireccion
        ? await this.resolverUbicacion(dto as CrearPropiedadDto)
        : null;

    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        // coalesce en TODOS los campos opcionales: esto es un PATCH, y lo que
        // no viene tiene que quedar como estaba. Escribir NULL en los campos
        // ausentes hace que actualizar un solo dato borre todos los demás.
        `UPDATE propiedad SET
           calle = coalesce($2, calle),
           numero = coalesce($3, numero),
           piso = coalesce($4, piso),
           depto = coalesce($5, depto),
           localidad = coalesce($6, localidad),
           provincia = coalesce($7, provincia),
           cp = coalesce($8, cp),
           lat = CASE WHEN $9::boolean THEN $10 ELSE lat END,
           lng = CASE WHEN $9::boolean THEN $11 ELSE lng END,
           geocode_fuente = CASE WHEN $9::boolean THEN $12 ELSE geocode_fuente END,
           geocode_el = CASE WHEN $9::boolean THEN $13 ELSE geocode_el END,
           tipo = coalesce($14, tipo),
           sup_total = coalesce($15, sup_total),
           sup_cubierta = coalesce($16, sup_cubierta),
           ambientes = coalesce($17, ambientes),
           dormitorios = coalesce($18, dormitorios),
           banos = coalesce($19, banos),
           cocheras = coalesce($20, cocheras),
           antiguedad = coalesce($21, antiguedad),
           orientacion = coalesce($22, orientacion),
           estado_conservacion = coalesce($23, estado_conservacion),
           amenities = coalesce($24, amenities),
           descripcion = coalesce($25, descripcion),
           notas_internas = coalesce($26, notas_internas),
           agente_captador_id = coalesce($27, agente_captador_id)
         WHERE id = $1`,
        [
          id, dto.calle ?? null, dto.numero ?? null, dto.piso ?? null, dto.depto ?? null,
          dto.localidad ?? null, dto.provincia ?? null, dto.cp ?? null,
          ubicacion !== null,
          ubicacion?.lat ?? null, ubicacion?.lng ?? null,
          ubicacion?.fuente ?? null, ubicacion?.fecha ?? null,
          dto.tipo ?? null, dto.supTotal ?? null, dto.supCubierta ?? null,
          dto.ambientes ?? null, dto.dormitorios ?? null, dto.banos ?? null,
          dto.cocheras ?? null, dto.antiguedad ?? null,
          dto.orientacion ?? null, dto.estadoConservacion ?? null,
          dto.amenities ?? null,
          dto.descripcion ?? null, dto.notasInternas ?? null,
          dto.agenteCaptadorId ?? null,
        ],
      );
      if (!rowCount) throw AppError.notFound('No se encontró esa propiedad.');

      if (dto.titulares) {
        await this.reemplazarTitulares(ej, tenantId, id, dto.titulares);
      }
      return this.leer(ej, id);
    });
  }

  async borrar(tenantId: string, id: string): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query('DELETE FROM propiedad WHERE id = $1', [id]);
      if (!rowCount) throw AppError.notFound('No se encontró esa propiedad.');
    });
  }

  // ── Operaciones ────────────────────────────────────────────────────────────

  async agregarOperacion(
    tenantId: string,
    propiedadId: string,
    dto: CrearOperacionDto,
  ): Promise<Propiedad> {
    return this.db.withTenant(tenantId, async (ej) => {
      try {
        await ej.query(
          `INSERT INTO operacion
             (tenant_id, propiedad_id, tipo, precio, moneda, expensas, expensas_moneda,
              estado, exclusividad_hasta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            tenantId, propiedadId, dto.tipo, dto.precio ?? null, dto.moneda,
            dto.expensas ?? null, dto.expensasMoneda ?? 'ARS',
            dto.estado ?? 'borrador', dto.exclusividadHasta ?? null,
          ],
        );
      } catch (err) {
        if (codigoPg(err) === '23505') {
          throw new AppError(
            409,
            ErrorCode.OPERACION_DUPLICADA,
            `La propiedad ya tiene una operación de ${dto.tipo} abierta. Cerrala antes de crear otra.`,
            'Conflict',
          );
        }
        if (codigoPg(err) === '23503') {
          throw AppError.notFound('No se encontró esa propiedad.');
        }
        throw err;
      }
      return this.leer(ej, propiedadId);
    });
  }

  async editarOperacion(
    tenantId: string,
    propiedadId: string,
    operacionId: string,
    dto: EditarOperacionDto,
  ): Promise<Propiedad> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE operacion SET
           precio = coalesce($3, precio),
           moneda = coalesce($4, moneda),
           expensas = coalesce($5, expensas),
           expensas_moneda = coalesce($6, expensas_moneda),
           estado = coalesce($7, estado),
           exclusividad_hasta = coalesce($8, exclusividad_hasta)
         WHERE id = $1 AND propiedad_id = $2`,
        [
          operacionId, propiedadId, dto.precio ?? null, dto.moneda ?? null,
          dto.expensas ?? null, dto.expensasMoneda ?? null,
          dto.estado ?? null, dto.exclusividadHasta ?? null,
        ],
      );
      if (!rowCount) throw AppError.notFound('No se encontró esa operación.');
      return this.leer(ej, propiedadId);
    });
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  /**
   * Cuántas propiedades no tienen ubicación y podrían resolverse solas.
   *
   * Deja afuera las de carga manual: ésas tienen coordenadas y no cuentan como
   * pendientes.
   */
  async contarSinUbicacion(tenantId: string): Promise<{ pendientes: number }> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM propiedad
          WHERE lat IS NULL AND geocode_fuente IS DISTINCT FROM 'manual'`,
      );
      return { pendientes: Number(rows[0].total) };
    });
  }

  /**
   * Geocodifica las propiedades que quedaron sin coordenadas.
   *
   * Es el equivalente de `POST /v1/indices/sincronizar` para los mapas, y hace
   * falta por una razón concreta: si la API key se configura DESPUÉS de haber
   * cargado la cartera —que es lo que pasa siempre— esas propiedades quedan sin
   * lat/lng para siempre. La geocodificación sólo corre al crear o al editar la
   * dirección, así que sin esto habría que abrir y volver a guardar cada ficha
   * a mano.
   *
   * **Idempotente**: sólo toca las que no tienen coordenadas. Correrlo dos veces
   * no vuelve a pagarle a Google por las que ya se resolvieron.
   *
   * **Nunca pisa una carga manual**: `geocode_fuente = 'manual'` significa que
   * alguien corrigió la ubicación a mano porque Google la ubicaba mal, y eso
   * gana siempre.
   */
  async geocodificarPendientes(
    tenantId: string,
    limite: number,
  ): Promise<{
    pendientes: number;
    procesadas: number;
    resueltas: number;
    resultados: Array<{ id: string; etiqueta: string; direccion: string; motivo: string }>;
  }> {
    if (!this.geo.configurado) {
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        'No hay GOOGLE_MAPS_API_KEY configurada. Sin la key no se puede geocodificar; ' +
          'las coordenadas se pueden cargar a mano desde cada ficha.',
        'Unprocessable Entity',
      );
    }

    // Se leen primero y se geocodifica DESPUÉS, fuera de la transacción: son
    // llamadas de red a un tercero, y hasta 50 de ellas con una transacción de
    // Postgres abierta esperándolas es una conexión tomada durante minutos.
    const { pendientes, tanda } = await this.db.withTenant(tenantId, async (ej) => {
      const { rows: cuenta } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM propiedad
          WHERE lat IS NULL AND geocode_fuente IS DISTINCT FROM 'manual'`,
      );
      const { rows } = await ej.query<{
        id: string; codigo: number; calle: string; numero: string | null;
        localidad: string | null; provincia: string | null;
      }>(
        `SELECT id, codigo, calle, numero, localidad, provincia
           FROM propiedad
          WHERE lat IS NULL AND geocode_fuente IS DISTINCT FROM 'manual'
          ORDER BY codigo
          LIMIT $1`,
        [limite],
      );
      return { pendientes: Number(cuenta[0].total), tanda: rows };
    });

    const resueltas: Array<{ id: string; lat: number; lng: number; fuente: string }> = [];
    const resultados: Array<{
      id: string; etiqueta: string; direccion: string; motivo: string;
    }> = [];

    for (const p of tanda) {
      const direccion = GeocodingService.direccionCompleta(p);
      const r = await this.geo.geocodificar(direccion);
      const etiqueta = `PROP-${String(p.codigo).padStart(4, '0')}`;

      if (r.coordenadas) {
        resueltas.push({ id: p.id, ...r.coordenadas });
      } else {
        // Se informa una por una: "18 de 20" sin decir cuáles fallaron obliga a
        // buscarlas a mano, y el motivo distingue "esa dirección no existe" de
        // "se cayó la key", que se arreglan de forma muy distinta.
        resultados.push({
          id: p.id,
          etiqueta,
          direccion,
          motivo:
            r.motivo === 'sin_resultados'
              ? 'Google no encontró esa dirección. Revisala o cargá lat/lng a mano.'
              : 'Falló la consulta a Google. Probá el diagnóstico de la key.',
        });
      }
    }

    if (resueltas.length) {
      await this.db.withTenant(tenantId, (ej) =>
        ej.query(
          `UPDATE propiedad p
              SET lat = x.lat, lng = x.lng, geocode_fuente = x.fuente, geocode_el = now()
             FROM unnest($1::uuid[], $2::numeric[], $3::numeric[], $4::text[])
                  AS x(id, lat, lng, fuente)
            WHERE p.id = x.id
              AND p.lat IS NULL
              AND p.geocode_fuente IS DISTINCT FROM 'manual'`,
          [
            resueltas.map((r) => r.id),
            resueltas.map((r) => r.lat),
            resueltas.map((r) => r.lng),
            resueltas.map((r) => r.fuente),
          ],
        ),
      );
    }

    return {
      pendientes,
      procesadas: tanda.length,
      resueltas: resueltas.length,
      resultados,
    };
  }

  private async resolverUbicacion(dto: CrearPropiedadDto): Promise<{
    lat: number | null;
    lng: number | null;
    fuente: string | null;
    fecha: Date | null;
  }> {
    // Coordenadas explícitas ganan siempre: es la salida cuando Google ubica mal
    // la dirección, y el usuario sabe más que el geocodificador.
    if (dto.lat != null && dto.lng != null) {
      return { lat: dto.lat, lng: dto.lng, fuente: 'manual', fecha: new Date() };
    }
    if (!dto.calle) return { lat: null, lng: null, fuente: null, fecha: null };

    const r = await this.geo.geocodificar(
      GeocodingService.direccionCompleta({
        calle: dto.calle,
        numero: dto.numero,
        localidad: dto.localidad,
        provincia: dto.provincia,
      }),
    );

    // Si no se pudo, se guarda sin coordenadas. Nunca una ubicación inventada:
    // una propiedad mal ubicada en el mapa es peor que una sin mapa.
    return r.coordenadas
      ? { ...r.coordenadas, fecha: new Date() }
      : { lat: null, lng: null, fuente: null, fecha: null };
  }

  private async reemplazarTitulares(
    ej: Ejecutor,
    tenantId: string,
    propiedadId: string,
    titulares: TitularDto[],
  ): Promise<void> {
    await ej.query('DELETE FROM titularidad WHERE propiedad_id = $1', [propiedadId]);

    if (titulares.length) {
      await ej.query(
        `INSERT INTO titularidad (tenant_id, propiedad_id, persona_id, porcentaje)
         SELECT $1, $2, x.persona_id, x.porcentaje
           FROM unnest($3::uuid[], $4::numeric[]) AS x(persona_id, porcentaje)`,
        [
          tenantId,
          propiedadId,
          titulares.map((t) => t.personaId),
          titulares.map((t) => t.porcentaje),
        ],
      );
    }

    // El trigger que valida la suma es DEFERRABLE: dispara al hacer COMMIT, no
    // acá. Se fuerza ahora para poder traducir el error a un mensaje útil en vez
    // de que explote un 500 al cerrar la transacción.
    try {
      await ej.query('SET CONSTRAINTS titularidad_suma_100 IMMEDIATE');
    } catch (err) {
      const suma = titulares.reduce((a, t) => a + Number(t.porcentaje), 0);
      throw new AppError(
        422,
        ErrorCode.TITULARIDAD_INVALIDA,
        `Los porcentajes de titularidad suman ${suma}%. Tienen que sumar 100%.`,
        'Unprocessable Entity',
      );
    }
  }

  private async leer(ej: Ejecutor, id: string): Promise<Propiedad> {
    const { rows } = await ej.query<FilaPropiedad>(
      `${SELECT_PROPIEDAD} WHERE p.id = $1`,
      [id],
    );
    if (!rows.length) throw AppError.notFound('No se encontró esa propiedad.');
    return aPropiedad(rows[0]);
  }
}

interface FilaPropiedad {
  id: string;
  codigo: number;
  calle: string;
  numero: string | null;
  piso: string | null;
  depto: string | null;
  localidad: string | null;
  provincia: string | null;
  cp: string | null;
  lat: string | null;
  lng: string | null;
  tipo: string;
  sup_total: string | null;
  sup_cubierta: string | null;
  ambientes: number | null;
  dormitorios: number | null;
  banos: number | null;
  cocheras: number | null;
  antiguedad: number | null;
  orientacion: string | null;
  estado_conservacion: string | null;
  amenities: string[];
  descripcion: string | null;
  notas_internas: string | null;
  operaciones: Array<Record<string, unknown>> | null;
  titulares: Array<Record<string, unknown>> | null;
}

const SELECT_PROPIEDAD = `
  SELECT p.*,
    (SELECT json_agg(json_build_object(
        'id', o.id, 'tipo', o.tipo, 'precio', o.precio, 'moneda', o.moneda,
        'expensas', o.expensas, 'expensasMoneda', o.expensas_moneda,
        'estado', o.estado, 'exclusividadHasta', o.exclusividad_hasta)
      ORDER BY o.tipo)
     FROM operacion o WHERE o.propiedad_id = p.id AND o.estado <> 'cerrada') AS operaciones,
    (SELECT json_agg(json_build_object(
        'personaId', t.persona_id,
        'nombre', trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')),
        'porcentaje', t.porcentaje)
      ORDER BY t.porcentaje DESC)
     FROM titularidad t JOIN persona pe ON pe.id = t.persona_id
     WHERE t.propiedad_id = p.id) AS titulares
  FROM propiedad p`;

function aPropiedad(f: FilaPropiedad): Propiedad {
  const direccion = [
    [f.calle, f.numero].filter(Boolean).join(' '),
    [f.piso && `Piso ${f.piso}`, f.depto && `Depto ${f.depto}`].filter(Boolean).join(' '),
    f.localidad,
  ]
    .filter(Boolean)
    .join(', ');

  return {
    id: f.id,
    codigo: f.codigo,
    etiqueta: `PROP-${String(f.codigo).padStart(4, '0')}`,
    direccion,
    calle: f.calle,
    numero: f.numero,
    piso: f.piso,
    depto: f.depto,
    localidad: f.localidad,
    provincia: f.provincia,
    cp: f.cp,
    lat: f.lat === null ? null : Number(f.lat),
    lng: f.lng === null ? null : Number(f.lng),
    ubicacionConocida: f.lat !== null && f.lng !== null,
    tipo: f.tipo,
    supTotal: num(f.sup_total),
    supCubierta: num(f.sup_cubierta),
    ambientes: f.ambientes,
    dormitorios: f.dormitorios,
    banos: f.banos,
    cocheras: f.cocheras,
    antiguedad: f.antiguedad,
    orientacion: f.orientacion,
    estadoConservacion: f.estado_conservacion,
    amenities: f.amenities ?? [],
    descripcion: f.descripcion,
    notasInternas: f.notas_internas,
    operaciones: (f.operaciones ?? []).map((o) => ({
      id: String(o.id),
      tipo: String(o.tipo),
      precio: o.precio === null ? null : Number(o.precio),
      moneda: String(o.moneda),
      expensas: o.expensas === null || o.expensas === undefined ? null : Number(o.expensas),
      expensasMoneda: String(o.expensasMoneda),
      estado: String(o.estado),
      exclusividadHasta: (o.exclusividadHasta as string) ?? null,
    })),
    titulares: (f.titulares ?? []).map((t) => ({
      personaId: String(t.personaId),
      nombre: String(t.nombre),
      porcentaje: Number(t.porcentaje),
    })),
  };
}

/** pg devuelve numeric como string para no perder precisión. */
function num(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function codigoPg(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}
