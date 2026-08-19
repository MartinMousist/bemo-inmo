import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { armarPagina, offset, type Pagina } from '../common/paginacion';
import { ordenSeguro } from '../common/orden';
import { GeocodingService } from './geocoding.service';
import { leerConfig, type ConfigComisiones } from '../ventas/comisiones.config.service';
import type {
  CrearOperacionDto,
  CrearPropiedadDto,
  EditarOperacionDto,
  EditarPropiedadDto,
  FiltroPropiedadesDto,
  TitularDto,
} from './propiedades.dto';

/**
 * Lo que se escribe en las cuatro columnas de ubicación de una propiedad.
 *
 * `null` en la ubicación entera —el valor de retorno, no los campos— significa
 * «no toques ninguna de las cuatro». Es distinto de `SIN_UBICACION`, que
 * significa «dejalas vacías»: la primera es la regla del PATCH parcial y la
 * segunda es una decisión.
 */
interface Ubicacion {
  lat: number | null;
  lng: number | null;
  fuente: string | null;
  fecha: Date | null;
}

const SIN_UBICACION: Ubicacion = { lat: null, lng: null, fuente: null, fecha: null };

export interface Operacion {
  id: string;
  tipo: string;
  precio: number | null;
  moneda: string;
  expensas: number | null;
  expensasMoneda: string;
  estado: string;
  exclusividadHasta: string | null;
  /** Desde cuándo se publica. Es lo que da los «días en mercado». */
  fechaPublicacion: string | null;
  /**
   * Sólo en operaciones de alquiler: hasta cuándo corre el contrato vigente, o
   * `null` si la unidad está libre.
   *
   * «Disponible» es el estado de la PUBLICACIÓN y no dice si la unidad está
   * ocupada: una con contrato hasta 2028 puede seguir figurando disponible
   * porque nadie tocó el estado de la operación. Sin este dato, un listado de
   * alquileres no contesta la única pregunta que se le hace — qué tengo para
   * ofrecer hoy.
   */
  contratoHasta: string | null;
  /**
   * Los honorarios que va a cobrar ESTA operación, ya resueltos: el override de
   * la propiedad sobre la política de la casa.
   *
   * `operacion.comision_config` existía desde la migración 006 y no la leía ni
   * la escribía una sola línea de código —el error #3 del playbook—. Sale con
   * `propio: false` cuando el número es el de la inmobiliaria, para que la
   * pantalla pueda decir de dónde viene en vez de mostrar un número suelto.
   */
  comision: {
    puntas: Record<string, number>;
    total: number;
    propio: boolean;
  } | null;
  /**
   * Quién cobra, cuando ya está definido.
   *
   * Vacío mientras la operación no cerró: ahí el porcentaje es de la casa y
   * todavía no tiene dueño. El captador de la propiedad se sabe siempre, pero
   * NO se mete acá inventándole un monto — se muestra aparte y con esa palabra.
   */
  beneficiarios: Beneficiario[];
}

/** Una línea del reparto ya hecho: una persona (o una inmobiliaria) y su parte. */
export interface Beneficiario {
  nombre: string;
  tipo: 'agente' | 'inmobiliaria_externa';
  /** La punta que cobra, o `null` si la línea no cuelga de una punta. */
  punta: string | null;
  porcentaje: number;
  monto: number;
  moneda: string;
  estado: string;
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
  /**
   * De dónde salió la coordenada: `'manual'`, `'google'` o `null`.
   *
   * La columna existe desde la 006 y no la devolvía nadie, así que la ficha
   * mostraba un punto en el mapa sin poder decir si lo puso una persona o el
   * geocodificador. Importa por dos cosas concretas: el backfill nunca pisa una
   * manual, y al cambiar la dirección la manual se respeta y la de Google se
   * limpia. Sin este dato en pantalla, las dos reglas son invisibles.
   */
  geocodeFuente: string | null;
  /** Cuándo se resolvió. Es la memoria de cálculo de la coordenada. */
  geocodeEl: string | null;
  tipo: string;
  supTotal: number | null;
  supCubierta: number | null;
  ambientes: number | null;
  dormitorios: number | null;
  banos: number | null;
  cocheras: number | null;
  antiguedad: number | null;
  /** Cantidad de plantas de la UNIDAD (un dúplex son 2). Migración 027. */
  plantas: number | null;
  /** Baños sin ducha ni bañera, aparte de `banos`. Migración 027. */
  toilettes: number | null;
  orientacion: string | null;
  /** `'frente' | 'contrafrente' | 'lateral' | 'interno'`. Migración 027. */
  disposicion: string | null;
  /** `'central' | 'individual' | 'radiadores' | ...`. Migración 027. */
  calefaccion: string | null;
  /** `'abierto' | 'barrio_privado' | 'country' | 'condominio'`. Migración 028. */
  tipoUrbanizacion: string | null;
  /** El complejo, cuando se sabe cuál — «Chacras Park». Migración 028. */
  nombreComplejo: string | null;
  estadoConservacion: string | null;
  amenities: string[];
  descripcion: string | null;
  notasInternas: string | null;
  /**
   * Quién captó la propiedad.
   *
   * Se escribe desde la ficha desde la migración 006 y `selectPropiedad()`
   * nunca lo devolvió: el dato estaba cargado y ninguna pantalla lo mostraba,
   * así que el reparto de la venta seguía pidiendo el captador a mano.
   */
  agenteCaptador: { id: string; nombre: string } | null;
  /**
   * La URL de la foto de portada, o `null` si la propiedad no tiene ninguna.
   *
   * Es lo único que la cartera en tarjetas necesita del bucket, y por eso es
   * una sola columna calculada y no un array: la grilla muestra UNA imagen por
   * propiedad. Devolver las treinta fotos de cada una para usar la primera
   * sería traer treinta veces más JSON del que se mira.
   *
   * `null` explícito y no `undefined` ni `''`: la tarjeta decide entre la foto
   * y el placeholder con este campo, y `''` es una URL vacía que el navegador
   * pide igual — un `<img>` roto en vez del placeholder digno.
   */
  fotoPortada: string | null;
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
      const params = [
        q, f.tipo ?? null, f.operacion ?? null, f.estado ?? null,
        f.incluirCerradas ?? false,
        f.agenteId ?? null, f.sinCaptador ?? false,
        // Rangos: cada Min/Max entra como su propio parámetro, y el `donde`
        // sólo lo aplica si no es NULL. `null` en vez de `undefined` porque el
        // driver no acepta `undefined` como valor de un parámetro posicional.
        f.ambientesMin ?? null, f.ambientesMax ?? null,
        f.dormitoriosMin ?? null, f.dormitoriosMax ?? null,
        f.banosMin ?? null, f.banosMax ?? null,
        f.toilettesMin ?? null, f.toilettesMax ?? null,
        f.cocherasMin ?? null, f.cocherasMax ?? null,
        f.plantasMin ?? null, f.plantasMax ?? null,
        f.antiguedadMax ?? null,
        f.supTotalMin ?? null, f.supTotalMax ?? null,
        f.supCubiertaMin ?? null, f.supCubiertaMax ?? null,
        // Multi-select: `null` y no `[]` cuando no vino, por la misma razón que
        // los rangos — `p.orientacion = ANY(NULL::text[])` es NULL (no matchea
        // nada) y necesita el `OR $N::text[] IS NULL` de abajo para no filtrar.
        f.orientacion ?? null,
        f.disposicion ?? null,
        f.calefaccion ?? null,
        f.amenities ?? null,
        f.tipoUrbanizacion ?? null,
      ];

      // El MISMO `donde` para el conteo y para la página. Si el filtro entrara
      // en uno solo, el pager diría «57» y la tabla mostraría 9, que es peor
      // que no filtrar: el usuario no sabe cuál de los dos números es el suyo.
      const donde = `
        WHERE ($1::text IS NULL
               OR p.calle ILIKE $1 OR p.localidad ILIKE $1 OR p.nombre_complejo ILIKE $1
               OR p.codigo::text = trim(both '%' from $1))
          AND ($2::text IS NULL OR p.tipo = $2)
          AND ($3::text IS NULL OR EXISTS (
                SELECT 1 FROM operacion o WHERE o.propiedad_id = p.id
                  AND o.tipo = $3
                  AND ($5::boolean OR o.estado <> 'cerrada')))
          AND ($4::text IS NULL OR EXISTS (
                SELECT 1 FROM operacion o WHERE o.propiedad_id = p.id AND o.estado = $4))
          AND ($6::uuid IS NULL OR p.agente_captador_id = $6)
          AND (NOT $7::boolean OR p.agente_captador_id IS NULL)
          AND ($8::int IS NULL OR p.ambientes >= $8)
          AND ($9::int IS NULL OR p.ambientes <= $9)
          AND ($10::int IS NULL OR p.dormitorios >= $10)
          AND ($11::int IS NULL OR p.dormitorios <= $11)
          AND ($12::int IS NULL OR p.banos >= $12)
          AND ($13::int IS NULL OR p.banos <= $13)
          AND ($14::int IS NULL OR p.toilettes >= $14)
          AND ($15::int IS NULL OR p.toilettes <= $15)
          AND ($16::int IS NULL OR p.cocheras >= $16)
          AND ($17::int IS NULL OR p.cocheras <= $17)
          AND ($18::int IS NULL OR p.plantas >= $18)
          AND ($19::int IS NULL OR p.plantas <= $19)
          AND ($20::int IS NULL OR p.antiguedad <= $20)
          AND ($21::numeric IS NULL OR p.sup_total >= $21)
          AND ($22::numeric IS NULL OR p.sup_total <= $22)
          AND ($23::numeric IS NULL OR p.sup_cubierta >= $23)
          AND ($24::numeric IS NULL OR p.sup_cubierta <= $24)
          AND ($25::text[] IS NULL OR p.orientacion = ANY($25))
          AND ($26::text[] IS NULL OR p.disposicion = ANY($26))
          AND ($27::text[] IS NULL OR p.calefaccion = ANY($27))
          -- @> y no &&: "tiene TODOS estos amenities", no "tiene alguno".
          AND ($28::text[] IS NULL OR p.amenities @> $28)
          AND ($29::text[] IS NULL OR p.tipo_urbanizacion = ANY($29))`;

      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM propiedad p ${donde}`,
        params,
      );

      const { rows } = await ej.query<FilaPropiedad>(
        `${selectPropiedad(f.incluirCerradas ?? false)} ${donde}
         ORDER BY ${ordenSeguro(
           {
             codigo: 'p.codigo',
             direccion: 'p.calle',
             superficie: 'p.sup_total',
             // El precio y la fecha de publicación viven en `operacion`, y una
             // propiedad puede tener DOS. Se ordena por la del listado que se
             // está mirando —el mismo `f.operacion` que ya filtra— o el número
             // sería el de la otra punta.
             precio: `(SELECT o.precio FROM operacion o
                        WHERE o.propiedad_id = p.id
                          AND ($3::text IS NULL OR o.tipo = $3) LIMIT 1)`,
             publicada: `(SELECT o.fecha_publicacion FROM operacion o
                           WHERE o.propiedad_id = p.id
                             AND ($3::text IS NULL OR o.tipo = $3) LIMIT 1)`,
           },
           'p.created_at DESC',
           f.orden,
           f.dir,
         )}
         LIMIT $30 OFFSET $31`,
        [...params, f.porPagina, offset(f)],
      );

      // La política de la casa se lee UNA vez por request y no una por fila:
      // es el mismo dato para las 25 propiedades de la página.
      const config = await leerConfig(ej, tenantId);
      return armarPagina(
        rows.map((r) => aPropiedad(r, config)),
        Number(conteo[0].total),
        f,
      );
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
           antiguedad, plantas, toilettes,
           orientacion, disposicion, calefaccion, tipo_urbanizacion, nombre_complejo,
           estado_conservacion, amenities,
           descripcion, notas_internas, agente_captador_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                 $9,$10,$11,$12,$13,$14,$15,$16,
                 $17,$18,$19,$20,$21,$22,$23,$24,
                 $25,$26,$27,$28,$29,$30,$31,$32,$33)
         RETURNING id`,
        [
          tenantId, cod[0].codigo,
          dto.calle, dto.numero ?? null, dto.piso ?? null, dto.depto ?? null,
          dto.localidad ?? null, dto.provincia ?? null, dto.cp ?? null,
          ubicacion.lat, ubicacion.lng, ubicacion.fuente, ubicacion.fecha,
          dto.tipo, dto.supTotal ?? null, dto.supCubierta ?? null,
          dto.ambientes ?? null, dto.dormitorios ?? null, dto.banos ?? null,
          dto.cocheras ?? null, dto.antiguedad ?? null,
          dto.plantas ?? null, dto.toilettes ?? null,
          dto.orientacion ?? null, dto.disposicion ?? null, dto.calefaccion ?? null,
          dto.tipoUrbanizacion ?? null, dto.nombreComplejo ?? null,
          dto.estadoConservacion ?? null,
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
    const ubicacion = await this.ubicacionAlEditar(tenantId, id, dto);

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
           plantas = coalesce($22, plantas),
           toilettes = coalesce($23, toilettes),
           orientacion = coalesce($24, orientacion),
           disposicion = coalesce($25, disposicion),
           calefaccion = coalesce($26, calefaccion),
           tipo_urbanizacion = coalesce($27, tipo_urbanizacion),
           nombre_complejo = coalesce($28, nombre_complejo),
           estado_conservacion = coalesce($29, estado_conservacion),
           amenities = coalesce($30, amenities),
           descripcion = coalesce($31, descripcion),
           notas_internas = coalesce($32, notas_internas),
           -- El captador es la EXCEPCIÓN al coalesce, con el mismo patrón que
           -- lat/lng: un null explícito acá significa «desasignar», no «no vino».
           --
           -- Con coalesce($27, agente_captador_id), una vez asignado no se podía
           -- volver atrás nunca, y el filtro «Sin captador» del listado —que
           -- existe porque las propiedades importadas por CSV nacen sin
           -- captador— era un estado al que se podía llegar pero del que no se
           -- podía salir ni entrar a mano. Quien asignó al asesor equivocado
           -- veía que borrar el nombre no hacía nada.
           --
           -- Lo que distingue los dos casos es undefined (el campo no vino en el
           -- PATCH) contra null (vino vacío), y por eso el booleano viaja aparte
           -- en $27 en vez de deducirse del valor.
           agente_captador_id = CASE WHEN $33::boolean THEN $34 ELSE agente_captador_id END
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
          dto.plantas ?? null, dto.toilettes ?? null,
          dto.orientacion ?? null, dto.disposicion ?? null, dto.calefaccion ?? null,
          dto.tipoUrbanizacion ?? null, dto.nombreComplejo ?? null,
          dto.estadoConservacion ?? null,
          dto.amenities ?? null,
          dto.descripcion ?? null, dto.notasInternas ?? null,
          dto.agenteCaptadorId !== undefined, dto.agenteCaptadorId ?? null,
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

  /**
   * Los honorarios de UNA operación: el override sobre la política de la casa.
   *
   * Mandar `{}` limpia el override y la operación vuelve a heredar. Ése es el
   * motivo por el que esto NO usa coalesce: acá «vacío» es una decisión —volvé
   * a lo de la casa— y no un campo que el usuario no tocó. La regla del PATCH
   * parcial sigue valiendo para todo lo demás de la operación, que se edita por
   * el otro endpoint.
   *
   * **No recalcula un reparto ya hecho, a propósito.** Cambiar el % de una
   * propiedad que ya tiene una venta con su reparto —y quizás con una comisión
   * cobrada— pisaría plata que ya se pagó. Este número pre-llena las operaciones
   * NUEVAS; para rehacer un reparto existente está el botón del detalle de la
   * venta, que además se bloquea si hay algo cobrado.
   */
  async editarComisiones(
    tenantId: string,
    propiedadId: string,
    operacionId: string,
    dto: { venta?: { compradora: number; vendedora: number };
           alquiler?: { locataria: number; locadora: number } },
  ): Promise<Propiedad> {
    for (const [nombre, par] of [
      ['venta', dto.venta && [dto.venta.compradora, dto.venta.vendedora]],
      ['alquiler', dto.alquiler && [dto.alquiler.locataria, dto.alquiler.locadora]],
    ] as const) {
      if (par && par[0] + par[1] > 100) {
        throw new AppError(
          422,
          ErrorCode.VALIDATION_FAILED,
          `Las dos puntas de ${nombre} no pueden sumar más del 100%.`,
          'Unprocessable Entity',
        );
      }
    }

    return this.db.withTenant(tenantId, async (ej) => {
      // El WHERE lleva `propiedad_id` además del id de la operación: sin él,
      // conocer un uuid de operación alcanzaría para escribirle el % a otra
      // propiedad de la misma inmobiliaria. La RLS corta entre tenants; esto
      // corta adentro del tenant.
      const { rowCount } = await ej.query(
        'UPDATE operacion SET comision_config = $3 WHERE id = $1 AND propiedad_id = $2',
        [operacionId, propiedadId, JSON.stringify(limpiarOverride(dto))],
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

  /**
   * Qué ubicación queda después de un PATCH. Es lo mismo que `resolverUbicacion`
   * pero para un cuerpo PARCIAL, que es donde estaban las tres formas de perder
   * una coordenada sin que nadie lo pidiera. Las tres se encontraron probando la
   * API contra la base de desarrollo, no leyendo el código:
   *
   *  1. **`PATCH { localidad }` borraba lat y lng.** Se resolvía la ubicación
   *     con el cuerpo del PATCH, que no trae `calle`; sin `calle` la función
   *     devolvía todo en `null` y el UPDATE lo escribía. Editar la localidad de
   *     una propiedad ubicada a mano la dejaba sin ubicación. Ahora se
   *     geocodifica la dirección que va a **quedar** guardada —el PATCH sobre lo
   *     que ya está en la base—, no la que vino en el cuerpo.
   *
   *  2. **`PATCH { lat }` sin `lng` borraba las dos.** No entraba en la rama
   *     manual (pide las dos) pero sí marcaba «hay que tocar la ubicación», así
   *     que caía en la misma rama de arriba. Ahora es un 422 que lo dice: media
   *     coordenada no es una coordenada.
   *
   *  3. **Corregir la provincia no volvía a geocodificar.** El disparador miraba
   *     `calle`, `numero` y `localidad`, pero `direccionCompleta()` **usa la
   *     provincia**: arreglar una propiedad cargada en la provincia equivocada
   *     dejaba el punto donde estaba, apuntando a la provincia vieja.
   *
   * Y la regla que ata todo: cuando hay que volver a geocodificar y no se puede
   * —sin API key, o Google no encuentra la dirección—, **una coordenada cargada
   * a mano se respeta**. Es la misma decisión que ya tomaba el backfill, que
   * nunca pisa un `geocode_fuente = 'manual'`. Lo que sí se limpia es lo que
   * había puesto Google, porque apuntaba a la dirección anterior. Salvo que el
   * usuario haya vaciado los dos campos a propósito: ahí pidió borrarlas.
   */
  private async ubicacionAlEditar(
    tenantId: string,
    id: string,
    dto: EditarPropiedadDto,
  ): Promise<Ubicacion | null> {
    const hayLat = dto.lat != null;
    const hayLng = dto.lng != null;
    if (hayLat !== hayLng) {
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        'La latitud y la longitud van juntas: mandá las dos o ninguna.',
        'Unprocessable Entity',
      );
    }
    // Coordenadas explícitas ganan siempre, igual que al crear.
    if (hayLat && hayLng) {
      return { lat: dto.lat!, lng: dto.lng!, fuente: 'manual', fecha: new Date() };
    }

    // `null` explícito en los dos es «borralas». Un campo AUSENTE queda en
    // `undefined` —class-transformer arma la instancia con todos los campos
    // declarados— y eso es «no lo toques»: la regla del PATCH parcial.
    const pidioBorrar = dto.lat === null && dto.lng === null;

    // Los cuatro campos que arma `direccionCompleta()`. `provincia` faltaba.
    const tocaDireccion =
      dto.calle !== undefined || dto.numero !== undefined
      || dto.localidad !== undefined || dto.provincia !== undefined;

    if (!tocaDireccion) return pidioBorrar ? SIN_UBICACION : null;

    const actual = await this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<{
        calle: string;
        numero: string | null;
        localidad: string | null;
        provincia: string | null;
        geocode_fuente: string | null;
      }>(
        `SELECT calle, numero, localidad, provincia, geocode_fuente
           FROM propiedad WHERE id = $1`,
        [id],
      );
      return rows[0] ?? null;
    });
    // No existe: el UPDATE de `editar()` es el que tira el 404, con su mensaje.
    if (!actual) return null;

    const direccion = GeocodingService.direccionCompleta({
      calle: dto.calle ?? actual.calle,
      numero: dto.numero ?? actual.numero,
      localidad: dto.localidad ?? actual.localidad,
      provincia: dto.provincia ?? actual.provincia,
    });

    // Que el PATCH MENCIONE la dirección no es que la dirección CAMBIE. El
    // formulario manda calle, número, localidad y provincia en cada guardado,
    // así que con «mencionar» alcanzando, tocar los ambientes disparaba una
    // geocodificación; y sin API key eso terminaba borrando la coordenada que
    // había puesto Google. Visto en el navegador: guardar «ambientes: 5» en
    // PROP-0032 la dejó sin ubicación. Se compara el texto que se le manda al
    // geocodificador, que es exactamente lo que decide si el resultado cambiaría.
    const anterior = GeocodingService.direccionCompleta(actual);
    if (direccion === anterior) return pidioBorrar ? SIN_UBICACION : null;

    const r = await this.geo.geocodificar(direccion);

    if (r.coordenadas) return { ...r.coordenadas, fecha: new Date() };
    if (!pidioBorrar && actual.geocode_fuente === 'manual') return null;
    return SIN_UBICACION;
  }

  private async resolverUbicacion(dto: CrearPropiedadDto): Promise<Ubicacion> {
    // Coordenadas explícitas ganan siempre: es la salida cuando Google ubica mal
    // la dirección, y el usuario sabe más que el geocodificador.
    if (dto.lat != null && dto.lng != null) {
      return { lat: dto.lat, lng: dto.lng, fuente: 'manual', fecha: new Date() };
    }
    if (!dto.calle) return SIN_UBICACION;

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
    return r.coordenadas ? { ...r.coordenadas, fecha: new Date() } : SIN_UBICACION;
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
      // Con las cerradas: la ficha es el legajo de la propiedad, no la vitrina.
      // Escondiéndolas, una unidad VENDIDA abría con «Sin operaciones» y sin una
      // palabra sobre el precio de cierre ni sobre el reparto de la comisión —
      // justo el dato que se va a buscar cuando ya se cerró.
      `${SELECT_PROPIEDAD_FICHA} WHERE p.id = $1`,
      [id],
    );
    if (!rows.length) throw AppError.notFound('No se encontró esa propiedad.');
    return aPropiedad(rows[0], await leerConfig(ej, rows[0].tenant_id));
  }
}

interface FilaPropiedad {
  id: string;
  tenant_id: string;
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
  geocode_fuente: string | null;
  /** `timestamptz`, no `date`: node-pg lo devuelve como `Date` y acá sí se
   *  puede convertir — la trampa del 01/01 es de las columnas `date`. */
  geocode_el: Date | null;
  tipo: string;
  sup_total: string | null;
  sup_cubierta: string | null;
  ambientes: number | null;
  dormitorios: number | null;
  banos: number | null;
  cocheras: number | null;
  antiguedad: number | null;
  plantas: number | null;
  toilettes: number | null;
  orientacion: string | null;
  disposicion: string | null;
  calefaccion: string | null;
  tipo_urbanizacion: string | null;
  nombre_complejo: string | null;
  estado_conservacion: string | null;
  amenities: string[];
  descripcion: string | null;
  notas_internas: string | null;
  agente_captador_id: string | null;
  captador_nombre: string | null;
  foto_portada: string | null;
  operaciones: Array<Record<string, unknown>> | null;
  titulares: Array<Record<string, unknown>> | null;
}

/**
 * `incluirCerradas` decide si el array de operaciones trae también las cerradas.
 *
 * El listado general muestra lo que se está ofreciendo, así que las cerradas
 * sobran. Las carteras de venta y de alquiler muestran lo que la inmobiliaria
 * TIENE, y ahí esconderlas es lo contrario de lo que se pide: una unidad
 * alquilada tiene su operación en `cerrada`, y sin ella la cartera de alquiler
 * mostraba 3 de 13 — justo las tres que no están alquiladas.
 */
const selectPropiedad = (incluirCerradas = false): string => `
  SELECT p.*,
    cap.nombre AS captador_nombre,
    -- La portada, para la cartera en tarjetas.
    --
    -- Es un ORDER BY y no un WHERE es_portada: el índice único parcial
    -- garantiza que no haya DOS portadas, no que haya UNA. Una propiedad
    -- importada, o una a la que le borraron la portada por fuera de
    -- FotosService.borrar(), tendría fotos y ninguna marcada — y con el WHERE
    -- se vería en la grilla como si no tuviera ninguna. Con el orden, la
    -- primera por orden hace de portada, que es lo que la ficha ya muestra
    -- arriba de todo.
    -- (Sin comillas invertidas en los nombres: un backtick adentro de un
    --  template literal lo cierra y tsc tira TS1005 en la línea de abajo.)
    (SELECT f.url FROM propiedad_foto f
      WHERE f.propiedad_id = p.id
      ORDER BY f.es_portada DESC, f.orden, f.created_at
      LIMIT 1) AS foto_portada,
    (SELECT json_agg(json_build_object(
        'id', o.id, 'tipo', o.tipo, 'precio', o.precio, 'moneda', o.moneda,
        'expensas', o.expensas, 'expensasMoneda', o.expensas_moneda,
        'estado', o.estado, 'exclusividadHasta', o.exclusividad_hasta,
        'fechaPublicacion', o.fecha_publicacion,
        'comisionConfig', o.comision_config,
        -- De QUIÉN es la comisión, cuando ya hay alguien asignado.
        --
        -- El porcentaje de la operación dice cuánto cobra la inmobiliaria; no
        -- dice quién se lo lleva. Eso recién existe cuando la operación se
        -- cierra y se arma el reparto: ahí la tabla comision tiene una fila por
        -- beneficiario. Antes de eso lo único que se sabe es el captador, y la
        -- pantalla lo dice con esas palabras en vez de inventar un cerrador.
        --
        -- Va en la misma subconsulta que las operaciones a propósito: resuelto
        -- aparte serían dos consultas por propiedad y el listado pagina de a 25.
        'beneficiarios', (
          SELECT json_agg(json_build_object(
              -- La casa no tiene fila en usuario ni nombre guardado: sin este
              -- CASE la línea salía como «Sin nombre», que es lo que menos
              -- ayuda justo en la que se lleva la parte más grande.
              'nombre', CASE WHEN cm.beneficiario_tipo = 'casa' THEN 'La inmobiliaria'
                             ELSE coalesce(u.nombre, cm.beneficiario_nombre, 'Sin nombre') END,
              'tipo', cm.beneficiario_tipo,
              'punta', cm.punta,
              'porcentaje', cm.porcentaje,
              'monto', cm.monto,
              'moneda', cm.moneda,
              'estado', cm.estado)
            ORDER BY cm.monto DESC)
           FROM comision cm
           LEFT JOIN usuario u ON u.id = cm.beneficiario_id
          -- La casa entra: sin ella el reparto suma 70 % y deja la pregunta
          -- «¿y el otro 30?» sin contestar, que es justo la que se hace quien
          -- mira esto. Queda afuera el nivel 'operacion', que no es un
          -- beneficiario sino el honorario bruto del que salen los demás.
          WHERE cm.beneficiario_tipo IN ('agente', 'inmobiliaria_externa', 'casa')
            AND cm.estado <> 'anulada'
            AND (cm.venta_id IN (SELECT v.id FROM operacion_venta v
                                  WHERE v.operacion_id = o.id)
              OR cm.contrato_id IN (SELECT c.id FROM contrato_alquiler c
                                     WHERE c.operacion_id = o.id))),
        'contratoHasta', (
          SELECT max(c.fecha_fin) FROM contrato_alquiler c
           WHERE c.propiedad_id = p.id AND c.estado = 'vigente'))
      ORDER BY o.tipo)
     FROM operacion o WHERE o.propiedad_id = p.id
       AND (${incluirCerradas ? 'TRUE' : "o.estado <> 'cerrada'"})) AS operaciones,
    (SELECT json_agg(json_build_object(
        'personaId', t.persona_id,
        'nombre', trim(coalesce(pe.nombre,'') || ' ' || coalesce(pe.apellido,'')),
        'porcentaje', t.porcentaje)
      ORDER BY t.porcentaje DESC)
     FROM titularidad t JOIN persona pe ON pe.id = t.persona_id
     WHERE t.propiedad_id = p.id) AS titulares
  FROM propiedad p
  LEFT JOIN usuario cap ON cap.id = p.agente_captador_id`;

const SELECT_PROPIEDAD = selectPropiedad();
const SELECT_PROPIEDAD_FICHA = selectPropiedad(true);

function aPropiedad(f: FilaPropiedad, config: ConfigComisiones): Propiedad {
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
    geocodeFuente: f.geocode_fuente,
    geocodeEl: f.geocode_el ? f.geocode_el.toISOString() : null,
    tipo: f.tipo,
    supTotal: num(f.sup_total),
    supCubierta: num(f.sup_cubierta),
    ambientes: f.ambientes,
    dormitorios: f.dormitorios,
    banos: f.banos,
    cocheras: f.cocheras,
    antiguedad: f.antiguedad,
    plantas: f.plantas,
    toilettes: f.toilettes,
    orientacion: f.orientacion,
    disposicion: f.disposicion,
    calefaccion: f.calefaccion,
    tipoUrbanizacion: f.tipo_urbanizacion,
    nombreComplejo: f.nombre_complejo,
    estadoConservacion: f.estado_conservacion,
    amenities: f.amenities ?? [],
    descripcion: f.descripcion,
    notasInternas: f.notas_internas,
    agenteCaptador: f.agente_captador_id
      ? { id: f.agente_captador_id, nombre: f.captador_nombre ?? '' }
      : null,
    // `?? null` y no el valor crudo: sin fotos la subconsulta devuelve NULL, que
    // node-pg trae como `null`, pero una fila armada a mano en un test podría no
    // traer la clave y ahí sería `undefined` — y `undefined` desaparece del JSON,
    // así que el front recibiría la clave ausente en vez de `null`.
    fotoPortada: f.foto_portada ?? null,
    operaciones: (f.operaciones ?? []).map((o) => ({
      id: String(o.id),
      tipo: String(o.tipo),
      precio: o.precio === null ? null : Number(o.precio),
      moneda: String(o.moneda),
      expensas: o.expensas === null || o.expensas === undefined ? null : Number(o.expensas),
      expensasMoneda: String(o.expensasMoneda),
      estado: String(o.estado),
      exclusividadHasta: (o.exclusividadHasta as string) ?? null,
      fechaPublicacion: (o.fechaPublicacion as string) ?? null,
      contratoHasta: (o.contratoHasta as string) ?? null,
      comision: comisionDeOperacion(
        String(o.tipo),
        (o.comisionConfig as Partial<ConfigComisiones>) ?? {},
        config,
      ),
      // `?? []` porque sin filas el `json_agg` devuelve NULL, no un array vacío:
      // el front recorre esto siempre y un `null` lo rompería.
      beneficiarios: ((o.beneficiarios as Array<Record<string, unknown>>) ?? []).map((b) => ({
        nombre: String(b.nombre),
        tipo: b.tipo as Beneficiario['tipo'],
        punta: (b.punta as string) ?? null,
        porcentaje: Number(b.porcentaje),
        monto: Number(b.monto),
        moneda: String(b.moneda),
        estado: String(b.estado),
      })),
    })),
    titulares: (f.titulares ?? []).map((t) => ({
      personaId: String(t.personaId),
      nombre: String(t.nombre),
      porcentaje: Number(t.porcentaje),
    })),
  };
}

/**
 * Los honorarios de una operación: su override sobre la política de la casa.
 *
 * El merge es **campo por campo**, la misma regla que `configEfectiva` y que
 * `leerConfig`: con `{"venta":{"compradora":4}}` guardado, un spread de primer
 * nivel dejaría `vendedora` en `undefined` y el listado mostraría 4 % de total
 * cuando la operación cobra 4 % + 3 %.
 *
 * Un alquiler temporario todavía no tiene puntas propias en la política de la
 * casa: usa las de alquiler, que es lo que hace la inmobiliaria hoy. Cuando
 * tenga las suyas se agregan al jsonb del tenant, no acá.
 */
function comisionDeOperacion(
  tipo: string,
  propio: Partial<ConfigComisiones>,
  casa: ConfigComisiones,
): Operacion['comision'] {
  if (tipo === 'venta') {
    const p = { ...casa.venta, ...(propio.venta ?? {}) };
    return {
      puntas: { compradora: p.compradora, vendedora: p.vendedora },
      total: round2(p.compradora + p.vendedora),
      propio: Boolean(propio.venta),
    };
  }
  const p = { ...casa.alquiler, ...(propio.alquiler ?? {}) };
  return {
    puntas: { locataria: p.locataria, locadora: p.locadora },
    total: round2(p.locataria + p.locadora),
    propio: Boolean(propio.alquiler),
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Sólo las secciones que vinieron. Lo que no vino, se hereda. */
function limpiarOverride(dto: {
  venta?: { compradora: number; vendedora: number };
  alquiler?: { locataria: number; locadora: number };
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (dto.venta) out.venta = dto.venta;
  if (dto.alquiler) out.alquiler = dto.alquiler;
  return out;
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
