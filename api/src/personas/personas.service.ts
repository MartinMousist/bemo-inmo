import { Injectable } from '@nestjs/common';
import { DbService, type Ejecutor } from '../database/db.service';
import { AppError, ErrorCode } from '../common/app-error';
import { armarPagina, offset, type Pagina, type PaginacionDto } from '../common/paginacion';
import type {
  CrearPersonaDto,
  EditarPersonaDto,
  ListarPersonasDto,
} from './personas.dto';

export interface Persona {
  id: string;
  tipo: 'fisica' | 'juridica';
  nombre: string;
  apellido: string | null;
  nombreCompleto: string;
  docTipo: string | null;
  docNumero: string | null;
  email: string | null;
  telefono: string | null;
  domicilio: string | null;
  notas: string | null;
}

/**
 * Los roles NO se guardan: se derivan de las relaciones reales. Una persona es
 * "propietaria" porque tiene una titularidad, no porque alguien marcó una
 * casilla. Un dato derivado no se desincroniza.
 *
 * Eran tres y son seis. Los tres que faltaban ya estaban en la base y no los
 * calculaba nadie —el error #3 del playbook—: `contrato_parte` sabe quién es
 * locatario desde la 007, `garantia` le dio legajo propio al garante en la 018
 * y `operacion_venta.comprador_id` existe desde la 008.
 *
 * «Locador» y «vendedor» NO son roles de esta lista, a propósito: son el
 * propietario visto desde un contrato o desde una venta, y tendrían los mismos
 * nombres con otro título. Queda un caso real sin cubrir —un `contrato_parte`
 * con rol 'locador' que NO es titular de la propiedad: un apoderado, una
 * sucesión, una sociedad que firma por el dueño— que hoy se queda sin ningún
 * rol derivado. Está anotado en el roadmap como pendiente: inventar un rol
 * «locador» sería idéntico a «propietario» el 99% de las veces y mentiría
 * justo en el 1% que importa.
 */
export const ROLES_PERSONA = [
  'propietario',
  'inquilino',
  'ex_inquilino',
  'garante',
  'ex_garante',
  'comprador',
  'interesado',
  'reservante',
] as const;

export type RolPersona = (typeof ROLES_PERSONA)[number];

export type EstadoSemaforo = 'sin_marcar' | 'recomendado' | 'con_reparos' | 'no_alquilar';

export const ESTADOS_SEMAFORO: EstadoSemaforo[] = [
  'sin_marcar', 'recomendado', 'con_reparos', 'no_alquilar',
];

/**
 * ⚠️ Este bloque NO sale de la inmobiliaria.
 *
 * No va al portal del propietario ni al del inquilino, ni a la Red, ni a un
 * envío a un cliente, ni al feed XML. Cada uno de esos cinco lugares arma su
 * propia proyección y ninguno incluye a `persona` entera — pero si alguien
 * agrega uno nuevo, esto es lo que tiene que quedarse afuera.
 */
export interface SemaforoPersona {
  estado: EstadoSemaforo;
  motivo: string | null;
  /** El NOMBRE de quien la marcó, no su id: es para leer. */
  por: string | null;
  el: string | null;
}

export interface PersonaConRoles extends Persona {
  semaforo: SemaforoPersona;
  roles: RolPersona[];
}

/**
 * Cuántas personas de la inmobiliaria tiene cada rol.
 *
 * `todas` es el total del tenant, no la suma de los otros seis: una persona con
 * tres roles cuenta en los tres, así que la suma da más que el total y está
 * bien que dé más.
 */
/**
 * El conteo se DERIVA de `ROLES_PERSONA`, no se escribe rol por rol.
 *
 * La versión anterior los listaba a mano acá y otra vez en el `return`, y al
 * agregar `ex_inquilino` y `ex_garante` la consulta los contaba y el objeto los
 * tiraba: la pantalla recibía `undefined` para los dos. Con el tipo derivado,
 * agregar un rol no deja nada que sincronizar.
 */
export type ConteoPorRol = { todas: number } & Record<RolPersona, number>;

@Injectable()
export class PersonasService {
  constructor(private readonly db: DbService) {}

  /**
   * El listado, paginado, con los seis roles derivados y el filtro por rol.
   *
   * ── Por qué la paginación va adentro de una CTE ──
   *
   * La CTE `pagina` ordena y corta 25 filas ANTES de derivar los roles; sin
   * ella, el `Result` que los proyecta queda arriba del Sort y abajo del Limit,
   * o sea que se evalúa para todas las filas.
   *
   * Medido de verdad con 5.000 personas (`scripts/medir-personas-rol.sh`,
   * mejor de tres):
   *
   *   sin CTE, página 1 ……… 6,4 ms · última página ……… 7,0 ms
   *   con CTE, página 1 ……… 4,6 ms · última página ……… 5,1 ms
   *
   * O sea: la CTE gana ~27% y es plana contra el número de página. **La mejora
   * es real pero MUCHO más chica de lo que se esperaba**, y conviene saber por
   * qué antes de "optimizar" esto otra vez: los seis roles se derivan con
   * `p.id IN (subconsulta)`, que Postgres planifica como un hash semi-join
   * construido UNA vez, no como un EXISTS correlacionado que se evalúa por
   * fila. La degradación catastrófica que se temía —cientos de ms en las
   * páginas altas— no aparece con esta forma de SQL. Aparecería si alguien
   * cambiara los `IN` por EXISTS correlacionados: ahí la misma cuenta, medida
   * en los conteos, salta de 7,5 ms a 140 ms.
   *
   * Se deja la CTE porque igual es más rápida y no cuesta nada, no porque
   * evite un desastre.
   *
   * El `ORDER BY` de afuera no es redundante: el orden de una CTE no está
   * garantizado a la salida.
   */
  async listar(tenantId: string, p: ListarPersonasDto): Promise<Pagina<PersonaConRoles>> {
    return this.db.withTenant(tenantId, async (ej) => {
      const filtro = p.q ? `%${p.q.trim()}%` : null;

      // El filtro por rol NO se hace con `'inquilino' = ANY(roles)` sobre el
      // array derivado: un array calculado en el SELECT no se puede filtrar
      // antes del LIMIT, así que obligaría a derivar los seis roles de todas
      // las filas — justo lo que la CTE viene a evitar. Va como semi-join
      // contra la tabla hija: medido con 5.000 personas, 2,4 ms (inquilino) y
      // 2,9 ms (garante, que son dos fuentes en UNION) contra los 5,1 ms de la
      // misma página sin filtro. Filtrar sale más barato que no filtrar.
      //
      // El texto se interpola y no viaja como parámetro porque es un fragmento
      // de SQL, no un valor. Sale de `CONJUNTO_ROL`, que es una lista blanca, y
      // se busca con `Object.hasOwn` para que un `rol` de `constructor` o
      // `__proto__` no encuentre una función en la cadena de prototipos —la
      // misma trampa que ya apareció en el motor de plantillas y en
      // `ordenSeguro`—. Igual el DTO ya lo validó con @IsIn: esto es la red.
      const porRol =
        p.rol && Object.hasOwn(CONJUNTO_ROL, p.rol)
          ? `AND p.id IN (${CONJUNTO_ROL[p.rol]})`
          : '';

      const donde = `
        WHERE ($1::text IS NULL
               OR (coalesce(p.nombre,'') || ' ' || coalesce(p.apellido,'')) ILIKE $1
               OR p.doc_numero ILIKE $1
               OR p.email::text ILIKE $1)
          ${porRol}`;

      // El conteo del paginador lleva EXACTAMENTE el mismo WHERE que la página.
      // Es la advertencia que ya está escrita en cartera.service.ts: si un
      // filtro entra en una consulta y no en la otra, el pager dice 40 y la
      // tabla muestra 12.
      const { rows: conteo } = await ej.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM persona p ${donde}`,
        [filtro],
      );

      const { rows } = await ej.query<FilaPersona>(
        `WITH pagina AS (
           -- Las columnas se listan una por una para no arrastrar lo que no se
           -- muestra. El costo es éste: al agregar el semáforo, la FICHA lo
           -- devolvía y la LISTA no, así que el chip no aparecía en ninguna
           -- fila. Se vio comparando las dos respuestas de la misma persona.
           -- (Sin comillas invertidas: adentro de un template literal lo
           --  cierran. Es la cuarta vez que se pisa en este repo.)
           SELECT p.id, p.tipo, p.nombre, p.apellido, p.doc_tipo, p.doc_numero,
                  p.email::text AS email, p.telefono, p.domicilio, p.notas,
                  p.semaforo, p.semaforo_motivo, p.semaforo_el,
                  (SELECT u.nombre FROM usuario u WHERE u.id = p.semaforo_por) AS semaforo_por
             FROM persona p
             ${donde}
            ORDER BY p.apellido NULLS LAST, p.nombre
            LIMIT $2 OFFSET $3
         )
         SELECT p.*, ${ROLES_DERIVADOS} FROM pagina p
          ORDER BY p.apellido NULLS LAST, p.nombre`,
        [filtro, p.porPagina, offset(p)],
      );

      return armarPagina(rows.map(aPersonaConRoles), Number(conteo[0].total), p);
    });
  }

  /**
   * Cuántas personas tiene cada rol. Una consulta, no seis.
   *
   * ── El conteo NO respeta el buscador, y es una decisión, no un olvido ──
   *
   * Las pestañas cuentan el ALCANCE —cuántos inquilinos tiene la inmobiliaria—
   * y la bajada de la pantalla cuenta lo FILTRADO («3 de 1.500 inquilinos»).
   * Son dos preguntas distintas y por eso son dos números distintos.
   *
   * Meter el `ILIKE '%…%'` acá adentro además cuesta caro y de forma
   * impredecible: medido, 26 / 64 / 96,6 ms según qué se tipeó en esta misma
   * forma, y 1,3 s / 6,3 s en la forma UNION ALL + GROUP BY. Postgres no puede
   * estimar la selectividad de un `ILIKE` con comodín adelante, así que el plan
   * se va a nested loop dependiendo del texto. Y el número saltaría en cada
   * tecla, con la fila de pestañas parpadeando.
   *
   * Se pide al montar la pantalla y después de un alta o una baja. Nunca por
   * tecla. Si la próxima sesión lee esto como un bug y «lo arregla», el
   * síntoma va a ser una pantalla que se traba al escribir.
   *
   * ── Por qué LEFT JOIN de conjuntos DISTINCT y no seis EXISTS ──
   *
   * Acá SÍ hay una diferencia grande, y es la única que apareció en toda la
   * medición. Con 5.000 personas: esta forma da **7,5 ms**; la misma cuenta con
   * EXISTS correlacionado da **140 ms**, casi veinte veces más, porque el
   * EXISTS se evalúa una vez por persona en vez de armar el conjunto una sola
   * vez. Ese es el motivo de que los conteos se escriban así y no de la forma
   * obvia.
   */
  async conteoPorRol(tenantId: string): Promise<ConteoPorRol> {
    return this.db.withTenant(tenantId, async (ej) => {
      const joins = ROLES_PERSONA.map(
        (rol) =>
          `LEFT JOIN (SELECT DISTINCT persona_id FROM (${CONJUNTO_ROL[rol]}) s_${rol})
             c_${rol} ON c_${rol}.persona_id = p.id`,
      ).join('\n        ');

      const columnas = ROLES_PERSONA.map(
        (rol) => `count(c_${rol}.persona_id)::text AS ${rol}`,
      ).join(', ');

      const { rows } = await ej.query<Record<string, string>>(
        `SELECT count(*)::text AS todas, ${columnas}
           FROM persona p
        ${joins}`,
      );

      const f = rows[0];
      // El `as` es porque `Object.fromEntries` devuelve un índice de string y
      // TypeScript no puede probar que las claves son exactamente las de
      // `RolPersona`. Lo son: salen de `ROLES_PERSONA`, que es el mismo array
      // del que sale el tipo. La alternativa —listar los ocho a mano— es lo que
      // se acaba de sacar por dejar dos sin devolver.
      const porRol = Object.fromEntries(
        ROLES_PERSONA.map((r) => [r, Number(f[r])]),
      ) as Record<RolPersona, number>;

      return { todas: Number(f.todas), ...porRol };
    });
  }

  /**
   * El semáforo: si a esta persona le volveríamos a alquilar.
   *
   * ── Qué es y qué no es ──
   *
   * Es lo que hoy vive en la cabeza de alguien o en un grupo de WhatsApp,
   * escrito donde se pueda leer. **No es un puntaje** y no sale de esta
   * inmobiliaria: ni al portal del inquilino, ni a la Red, ni a un envío, ni al
   * feed. Es la opinión de ESTA oficina sobre una persona con nombre y
   * apellido.
   *
   * ── Avisa, nunca bloquea ──
   *
   * No hay ningún lugar del sistema que impida armar un contrato con alguien
   * marcado. Que el software se niegue a dejarte alquilarle a una persona es
   * una decisión que no le corresponde, y una marca puesta con bronca dejaría a
   * alguien afuera en silencio y para siempre.
   *
   * ── El motivo es obligatorio ──
   *
   * Una marca sin motivo es un rumor con forma de dato: dentro de seis meses
   * nadie sabe por qué está puesta, y quien la lee no puede evaluarla. Se exige
   * acá y no con un CHECK porque «sin marcar» no lleva motivo.
   */
  async marcarSemaforo(
    tenantId: string,
    personaId: string,
    usuarioId: string,
    estado: string,
    motivo?: string,
  ): Promise<PersonaConRoles> {
    if (estado !== 'sin_marcar' && !motivo?.trim()) {
      throw new AppError(
        400,
        ErrorCode.VALIDATION_FAILED,
        'Escribí por qué. Una marca sin motivo no le sirve a nadie dentro de seis meses.',
        'Bad Request',
      );
    }

    return this.db.withTenant(tenantId, async (ej) => {
      const { rowCount } = await ej.query(
        `UPDATE persona
            SET semaforo = $2,
                -- Al desmarcar se limpia todo: dejar el motivo viejo colgando
                -- de un «sin marcar» es peor que no tener nada.
                semaforo_motivo = CASE WHEN $2 = 'sin_marcar' THEN NULL ELSE $3 END,
                semaforo_por    = CASE WHEN $2 = 'sin_marcar' THEN NULL ELSE $4::uuid END,
                semaforo_el     = CASE WHEN $2 = 'sin_marcar' THEN NULL ELSE now() END
          WHERE id = $1`,
        [personaId, estado, motivo?.trim() ?? null, usuarioId],
      );
      if (!rowCount) throw AppError.notFound('No se encontró esa persona.');

      const { rows } = await ej.query<FilaPersona>(
        `${SELECT_PERSONA} WHERE p.id = $1`, [personaId],
      );
      return aPersonaConRoles(rows[0]);
    });
  }

  async obtener(tenantId: string, id: string): Promise<PersonaConRoles> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaPersona>(`${SELECT_PERSONA} WHERE p.id = $1`, [
        id,
      ]);
      if (!rows.length) throw AppError.notFound('No se encontró esa persona.');
      return aPersonaConRoles(rows[0]);
    });
  }

  /**
   * Búsqueda por documento con alta inline: el front busca, y si no existe,
   * el formulario de alta aparece ahí mismo con el documento ya cargado. Nunca
   * "no encontrado, andá a otra pantalla a crearlo".
   */
  async buscarPorDocumento(
    tenantId: string,
    docNumero: string,
  ): Promise<PersonaConRoles | null> {
    return this.db.withTenant(tenantId, async (ej) => {
      const { rows } = await ej.query<FilaPersona>(
        `${SELECT_PERSONA} WHERE p.doc_numero = $1 LIMIT 1`,
        [docNumero],
      );
      return rows.length ? aPersonaConRoles(rows[0]) : null;
    });
  }

  async crear(tenantId: string, dto: CrearPersonaDto): Promise<PersonaConRoles> {
    return this.db.withTenant(tenantId, async (ej) => {
      const id = await this.insertar(ej, tenantId, dto);
      const { rows } = await ej.query<FilaPersona>(`${SELECT_PERSONA} WHERE p.id = $1`, [
        id,
      ]);
      return aPersonaConRoles(rows[0]);
    });
  }

  async editar(
    tenantId: string,
    id: string,
    dto: EditarPersonaDto,
  ): Promise<PersonaConRoles> {
    return this.db.withTenant(tenantId, async (ej) => {
      try {
        const { rowCount } = await ej.query(
          // PATCH: lo que no viene queda como estaba. Ver el mismo comentario
          // en propiedades.service.ts.
          `UPDATE persona SET
             tipo = coalesce($2, tipo),
             nombre = coalesce($3, nombre),
             apellido = coalesce($4, apellido),
             doc_tipo = coalesce($5, doc_tipo),
             doc_numero = coalesce($6, doc_numero),
             email = coalesce($7, email),
             telefono = coalesce($8, telefono),
             domicilio = coalesce($9, domicilio),
             notas = coalesce($10, notas)
           WHERE id = $1`,
          [
            id,
            dto.tipo ?? null,
            dto.nombre ?? null,
            dto.apellido ?? null,
            dto.docTipo ?? null,
            dto.docNumero ?? null,
            dto.email ?? null,
            dto.telefono ?? null,
            dto.domicilio ?? null,
            dto.notas ?? null,
          ],
        );
        // 404 y no un 200 vacío: si la fila es de otra inmobiliaria, RLS la
        // esconde y el UPDATE afecta cero filas. Devolver 200 mentiría.
        if (!rowCount) throw AppError.notFound('No se encontró esa persona.');
      } catch (err) {
        throw this.traducir(err);
      }

      const { rows } = await ej.query<FilaPersona>(`${SELECT_PERSONA} WHERE p.id = $1`, [
        id,
      ]);
      return aPersonaConRoles(rows[0]);
    });
  }

  async borrar(tenantId: string, id: string): Promise<void> {
    await this.db.withTenant(tenantId, async (ej) => {
      try {
        const { rowCount } = await ej.query('DELETE FROM persona WHERE id = $1', [id]);
        if (!rowCount) throw AppError.notFound('No se encontró esa persona.');
      } catch (err) {
        if (codigoPg(err) === '23503') {
          throw new AppError(
            409,
            ErrorCode.EN_USO,
            'No se puede borrar: la persona es titular de una propiedad o parte de una operación.',
            'Conflict',
          );
        }
        throw err;
      }
    });
  }

  /** Reutilizable desde otros servicios que crean personas al vuelo. */
  async insertar(ej: Ejecutor, tenantId: string, dto: CrearPersonaDto): Promise<string> {
    try {
      const { rows } = await ej.query<{ id: string }>(
        `INSERT INTO persona
           (tenant_id, tipo, nombre, apellido, doc_tipo, doc_numero,
            email, telefono, domicilio, notas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          tenantId,
          dto.tipo ?? 'fisica',
          dto.nombre,
          dto.apellido ?? null,
          dto.docTipo ?? null,
          dto.docNumero ?? null,
          dto.email ?? null,
          dto.telefono ?? null,
          dto.domicilio ?? null,
          dto.notas ?? null,
        ],
      );
      return rows[0].id;
    } catch (err) {
      throw this.traducir(err);
    }
  }

  private traducir(err: unknown): unknown {
    if (codigoPg(err) === '23505') {
      return new AppError(
        409,
        ErrorCode.DOCUMENTO_DUPLICADO,
        'Ya existe una persona con ese documento.',
        'Conflict',
      );
    }
    return err;
  }
}

interface FilaPersona {
  semaforo: string | null;
  semaforo_motivo: string | null;
  semaforo_por: string | null;
  semaforo_el: string | null;
  id: string;
  tipo: 'fisica' | 'juridica';
  nombre: string;
  apellido: string | null;
  doc_tipo: string | null;
  doc_numero: string | null;
  email: string | null;
  telefono: string | null;
  domicilio: string | null;
  notas: string | null;
  roles: string[];
}

/**
 * De dónde sale cada rol. **Una sola definición** para las tres cosas que la
 * usan: el chip del listado, el filtro por rol y el conteo de cada pestaña.
 *
 * Que sean tres consultas distintas contra la misma definición es lo único que
 * garantiza que la pestaña diga «Garantes 17» y el listado filtrado por
 * garantes traiga 17. Tenerlo escrito tres veces es tenerlo mal escrito dos.
 *
 * Cada fragmento devuelve una columna `persona_id`. Las tres reglas que no son
 * obvias:
 *
 * 1. **`garante` tiene DOS fuentes y hasta hoy nadie las juntaba.**
 *    `contrato_parte` con rol garante/fiador viene de la 007, y la 018 le dio
 *    al garante legajo propio en `garantia` —con documentos, firma y veredicto
 *    del BCRA—. Un garante puede existir en una sola de las dos: `crear()` de
 *    garantes.service inserta en las dos, pero un contrato viejo cargado antes
 *    de la 018, o una garantía sin parte, quedan de un solo lado. Mirar una
 *    fuente sola muestra MENOS garantes de los que hay, y el número se ve
 *    razonable — es exactamente el patrón por el que el árbol de comisiones del
 *    seed estuvo mal en diez de once ventas sin que nadie lo notara.
 *
 * 2. **`comprador` excluye las ventas caídas**, con el mismo criterio con el
 *    que `reservante` exige `estado = 'activa'` desde la etapa 3: una operación
 *    que se cayó devuelve a la persona a ser un interesado. No compró nada.
 *
 * 3. **`inquilino` NO mira el estado del contrato.** Haber sido locatario es un
 *    hecho, no una situación vigente; y sumar un JOIN a `contrato_alquiler` en
 *    la derivación la encarece para las seis pestañas. El recorte a «contratos
 *    vigentes» es de la PANTALLA Inquilinos, que lista contratos, no de acá.
 *    Por eso los dos números no coinciden, y por eso la pantalla dice los dos.
 */
/**
 * Un contrato que todavía cuenta. Se usa cuatro veces abajo.
 *
 * `vigente` y `por_iniciar`: el que arranca el mes que viene ya tiene inquilino,
 * y decir que no lo es hasta el día de la mudanza sería falso al revés.
 */
const CONTRATO_EN_CURSO = "c.estado IN ('vigente', 'por_iniciar')";

export const CONJUNTO_ROL: Record<RolPersona, string> = {
  // El propietario NO caduca: la propiedad sigue siendo suya aunque no haya
  // ningún contrato encima, y aunque esté archivada.
  propietario: 'SELECT persona_id FROM titularidad',

  /*
   * ── Los roles caducan ──
   *
   * Antes «inquilino» salía de `contrato_parte` sin mirar el estado del
   * contrato, así que alguien que alquiló en 2019 y se fue seguía siendo
   * inquilino para siempre. La ficha de una persona mentía, y la pantalla de
   * Inquilinos mezclaba a los de hoy con los de hace seis años.
   *
   * Ahora «inquilino» quiere decir ACTUAL, y quien lo fue queda como
   * `ex_inquilino` — que no es lo mismo y hay que poder distinguirlo: a un ex
   * inquilino se le puede volver a alquilar, y para eso está el semáforo.
   */
  inquilino:
    'SELECT cp.persona_id FROM contrato_parte cp ' +
    'JOIN contrato_alquiler c ON c.id = cp.contrato_id ' +
    `WHERE cp.rol = 'locatario' AND ${CONTRATO_EN_CURSO}`,

  // Tuvo alguno y NINGUNO en curso. El `EXCEPT` es lo que evita que una persona
  // con un contrato vivo y tres viejos aparezca como las dos cosas.
  ex_inquilino:
    "SELECT persona_id FROM contrato_parte WHERE rol = 'locatario' " +
    'EXCEPT SELECT cp.persona_id FROM contrato_parte cp ' +
    'JOIN contrato_alquiler c ON c.id = cp.contrato_id ' +
    `WHERE cp.rol = 'locatario' AND ${CONTRATO_EN_CURSO}`,

  garante:
    'SELECT cp.persona_id FROM contrato_parte cp ' +
    'JOIN contrato_alquiler c ON c.id = cp.contrato_id ' +
    `WHERE cp.rol IN ('garante', 'fiador') AND ${CONTRATO_EN_CURSO} ` +
    'UNION SELECT g.persona_id FROM garantia g ' +
    'JOIN contrato_alquiler c ON c.id = g.contrato_id ' +
    `WHERE g.persona_id IS NOT NULL AND ${CONTRATO_EN_CURSO}`,

  ex_garante:
    "SELECT persona_id FROM contrato_parte WHERE rol IN ('garante', 'fiador') " +
    'UNION SELECT persona_id FROM garantia WHERE persona_id IS NOT NULL ' +
    'EXCEPT (' +
    'SELECT cp.persona_id FROM contrato_parte cp ' +
    'JOIN contrato_alquiler c ON c.id = cp.contrato_id ' +
    `WHERE cp.rol IN ('garante', 'fiador') AND ${CONTRATO_EN_CURSO} ` +
    'UNION SELECT g.persona_id FROM garantia g ' +
    'JOIN contrato_alquiler c ON c.id = g.contrato_id ' +
    `WHERE g.persona_id IS NOT NULL AND ${CONTRATO_EN_CURSO})`,
  comprador:
    'SELECT comprador_id AS persona_id FROM operacion_venta ' +
    "WHERE comprador_id IS NOT NULL AND estado <> 'caida'",
  interesado: 'SELECT persona_id FROM oportunidad',
  reservante: "SELECT persona_id FROM reserva WHERE estado = 'activa'",
};

/**
 * Los seis roles como array, para el `SELECT`. Espera un alias `p` con `id`.
 *
 * Va SIEMPRE sobre pocas filas: en el listado, adentro de la CTE ya paginada;
 * en `obtener()`, sobre una. Proyectarlo sobre la tabla entera es el plan malo
 * que documenta `listar()`.
 */
export const ROLES_DERIVADOS = `array_remove(ARRAY[
  ${ROLES_PERSONA.map(
    (rol) => `CASE WHEN p.id IN (${CONJUNTO_ROL[rol]}) THEN '${rol}' END`,
  ).join(',\n  ')}
], NULL) AS roles`;

// Los roles salen de las relaciones, no de una columna. Esta forma es para leer
// UNA persona (la ficha, el alta, la edición): ahí el `WHERE p.id = $1` corta
// primero y derivar los roles cuesta lo mismo con CTE o sin ella.
const SELECT_PERSONA = `
  SELECT p.id, p.tipo, p.nombre, p.apellido, p.doc_tipo, p.doc_numero,
         p.email::text AS email, p.telefono, p.domicilio, p.notas,
         p.semaforo, p.semaforo_motivo, p.semaforo_el,
         (SELECT u.nombre FROM usuario u WHERE u.id = p.semaforo_por) AS semaforo_por,
         ${ROLES_DERIVADOS}
    FROM persona p`;

function aPersonaConRoles(f: FilaPersona): PersonaConRoles {
  const nombreCompleto = [f.nombre, f.apellido].filter(Boolean).join(' ');
  return {
    id: f.id,
    tipo: f.tipo,
    nombre: f.nombre,
    apellido: f.apellido,
    nombreCompleto,
    docTipo: f.doc_tipo,
    docNumero: f.doc_numero,
    email: f.email,
    telefono: f.telefono,
    domicilio: f.domicilio,
    notas: f.notas,
    // El semáforo viaja SIEMPRE, incluso «sin marcar»: la pantalla necesita
    // saber que existe la marca para poder ofrecer ponerla.
    semaforo: {
      estado: (f.semaforo ?? 'sin_marcar') as EstadoSemaforo,
      motivo: f.semaforo_motivo ?? null,
      por: f.semaforo_por ?? null,
      el: f.semaforo_el ?? null,
    },
    roles: (f.roles ?? []) as RolPersona[],
  };
}

function codigoPg(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}
