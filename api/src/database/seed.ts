import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import { correrSql } from './migrator';
import { AlmacenamientoService } from '../archivos/almacenamiento.service';
import { PLANTILLAS_POR_DEFECTO } from '../plantillas/plantillas.defecto';
import { generarAviso } from '../publicaciones/aviso.motor';
import { CAMPOS_AVISO, datosParaAviso, type FilaAviso } from '../publicaciones/publicaciones.datos';
import {
  AjusteImposible,
  calcularAjuste,
  periodosDeAjuste,
  sumarMeses,
  type TipoIndice,
} from '../alquileres/ajustes.motor';

/**
 * El seed demo: `demo.sql` primero, y después lo que **no se puede escribir en
 * SQL sin duplicar el código que ya lo genera**.
 *
 * Las plantillas son tres carillas de texto legal que viven en
 * `plantillas.defecto.ts`, y el aviso de una publicación lo arma
 * `generarAviso()` con un formato que cambia. Copiar cualquiera de los dos al
 * `.sql` deja dos versiones de la misma cosa, y la que envejece es la copia:
 * el usuario vería un pre-contrato viejo o un aviso que el sistema hoy no
 * genera así. Por eso este paso corre en TypeScript, contra las mismas
 * funciones que usa la aplicación.
 *
 * ⚠️ **Corre como OWNER, que saltea RLS.** Cada consulta filtra por
 * `tenant_id` a mano. No es un detalle de estilo: ya pasó una vez —el seed
 * marcó como pagadas siete cuotas de una inmobiliaria ajena porque un `UPDATE`
 * confió en un aislamiento que, con este rol, no existe.
 *
 * Idempotente, como el `.sql`: `SEED_ON_BOOT` lo corre en cada arranque de dev.
 */

/** Los mismos UUID fijos que usa `seeds/demo.sql`. */
const ANDES = '11111111-1111-4111-8111-111111111111';
const PLATA = '22222222-2222-4222-8222-222222222222';

/**
 * Los avisos de la demo.
 *
 * Todos nacen `lista`, que es **exactamente lo que produce el sistema**: sin
 * convenio con el portal, `PublicacionesService.crear()` no marca `publicada`
 * porque nadie publicó nada. Sembrar acá una `publicada` con una URL de
 * Zonaprop inventada sería la misma mentira, escrita a mano y encima con un
 * link roto. Los otros dos estados —`pausada` y `baja`— sí los pone una
 * persona, y están para que el filtro por estado tenga algo que filtrar.
 *
 * PROP-0011 va en dos portales y en dos operaciones a la vez: la misma casa en
 * venta y en alquiler genera dos avisos distintos, que es el caso que hace
 * evidente por qué la publicación cuelga de la operación y no de la propiedad.
 */
const PUBLICACIONES: Array<{
  id: string;
  operacionId: string;
  portal: string;
  estado: string;
}> = [
  // PROP-0001 · departamento en venta, Arístides Villanueva
  { id: '9b000000-0000-4000-8000-000000000001', operacionId: 'c0000000-0000-4000-8000-000000000002', portal: 'zonaprop',  estado: 'lista' },
  { id: '9b000000-0000-4000-8000-000000000002', operacionId: 'c0000000-0000-4000-8000-000000000002', portal: 'argenprop', estado: 'lista' },
  // PROP-0011 · la casa de Maipú, en venta Y en alquiler
  { id: '9b000000-0000-4000-8000-000000000003', operacionId: 'c0000000-0000-4000-8000-000000000014', portal: 'zonaprop',  estado: 'lista' },
  { id: '9b000000-0000-4000-8000-000000000004', operacionId: 'c0000000-0000-4000-8000-000000000015', portal: 'mercadolibre', estado: 'lista' },
  // PROP-0013 · el terreno de Chacras
  { id: '9b000000-0000-4000-8000-000000000005', operacionId: 'c0000000-0000-4000-8000-000000000017', portal: 'inmoup',    estado: 'lista' },
  // PROP-0009 · el galpón. Pausado: el dueño lo sacó de circulación un mes.
  { id: '9b000000-0000-4000-8000-000000000006', operacionId: 'c0000000-0000-4000-8000-000000000012', portal: 'zonaprop',  estado: 'pausada' },
  // PROP-0010 · el monoambiente, ya reservado: el aviso se dio de baja.
  { id: '9b000000-0000-4000-8000-000000000007', operacionId: 'c0000000-0000-4000-8000-000000000024', portal: 'argenprop', estado: 'baja' },
];

/**
 * Los documentos de los garantes de la demo.
 *
 * `garantia_documento.url` es texto libre: si el `.sql` escribiera una URL, esa
 * URL no existiría en el bucket y la miniatura se vería rota — dato falso en la
 * pantalla, que es la regla que este producto no negocia. Los archivos se
 * suben de verdad, con las mismas funciones que usa la app.
 *
 * Cada garante trae un caso distinto a propósito: uno completo, uno a medias,
 * uno que apenas presentó el DNI y una póliza, que no tiene ni DNI ni recibos.
 * Ver el comentario de `garantia` en `seeds/demo.sql`.
 */
const DOCUMENTOS_GARANTE: Array<{ garantiaId: string; tipos: string[] }> = [
  // Adriana Rossi · contrato 1 · legajo completo
  {
    garantiaId: '9c000000-0000-4000-8000-000000000001',
    tipos: ['dni_frente', 'dni_dorso', 'recibo_1', 'recibo_2', 'recibo_3'],
  },
  // Héctor Molina · contrato 1 · el segundo, también completo
  {
    garantiaId: '9c000000-0000-4000-8000-000000000002',
    tipos: ['dni_frente', 'dni_dorso', 'recibo_1', 'recibo_2', 'recibo_3'],
  },
  // Pablo Arce · contrato 2 · firmó pero le faltan dos recibos
  {
    garantiaId: '9c000000-0000-4000-8000-000000000003',
    tipos: ['dni_frente', 'dni_dorso', 'recibo_1'],
  },
  // Silvina Correa · contrato 5 · sólo el DNI, y sin firmar
  {
    garantiaId: '9c000000-0000-4000-8000-000000000004',
    tipos: ['dni_frente', 'dni_dorso'],
  },
  // El seguro de caución · contrato 4 · la póliza, que es su único documento
  { garantiaId: '9c000000-0000-4000-8000-000000000005', tipos: ['otro'] },
];

/** El usuario que "subió" los documentos de la demo: la titular de Andes. */
const OWNER_ANDES = '11000000-0000-4000-8000-000000000001';

/**
 * Los cuatro contratos que existen para que el ajuste se vea proyectar.
 *
 * Sus aumentos NO se escriben a mano en el `.sql`: se calculan acá con
 * `calcularAjuste()` y `periodosDeAjuste()`, o sea con el mismo motor que usa la
 * aplicación. Un ajuste tipeado con su coeficiente ya resuelto es el resultado
 * dibujado, no el sistema funcionando — y si mañana cambia la regla, la demo
 * muestra números que la app no produce.
 */
const CONTRATOS_QUE_PROYECTAN = [
  'd0000000-0000-4000-8000-000000000015', // ICL cuatrimestral, 2 años
  'd0000000-0000-4000-8000-000000000016', // ICL trimestral
  'd0000000-0000-4000-8000-000000000017', // IPC trimestral
  'd0000000-0000-4000-8000-000000000018', // IPC cuatrimestral
];

/** Cuántos meses hacia atrás cubre la serie de IPC demo. */
const MESES_IPC_DEMO = 48;

/**
 * Variación mensual de la serie de IPC demo: 2,1%.
 *
 * Un número plausible y **redondo a propósito**: nadie tiene que poder confundir
 * esta serie con el IPC publicado. Lo que la delata de verdad no es el número
 * sino la `fuente`, que lo dice con todas las letras y se ve en la pantalla de
 * Índices al lado de cada valor.
 */
const PASO_IPC_DEMO = 1.021;

const FUENTE_IPC_DEMO = 'demo · valor de ejemplo, no es el IPC publicado por INDEC';

export interface ResultadoSeed {
  plantillas: number;
  publicaciones: number;
  documentos: number;
  indices: number;
  ajustes: number;
}

export async function sembrarDemo(
  ownerUrl: string,
  log: (msg: string) => void = () => undefined,
): Promise<ResultadoSeed> {
  await correrSql(ownerUrl, join(__dirname, '..', '..', 'seeds', 'demo.sql'));

  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const plantillas =
      (await sembrarPlantillas(client, ANDES)) + (await sembrarPlantillas(client, PLATA));
    const publicaciones = await sembrarPublicaciones(client);
    const documentos = await sembrarDocumentosGarantes(client, log);
    // El orden importa: primero los índices, después los ajustes. Sin la serie
    // de IPC, los dos contratos que ajustan por IPC no proyectan ni uno.
    const indices = await sembrarIpcDemo(client, log);
    const ajustes = await proyectarAjustesDemo(client, log);

    log(
      `Seed demo aplicado. Plantillas nuevas: ${plantillas}. ` +
        `Avisos nuevos: ${publicaciones}. Documentos de garantes nuevos: ${documentos}. ` +
        `Valores de IPC demo: ${indices}. Ajustes proyectados: ${ajustes}.`,
    );
    return { plantillas, publicaciones, documentos, indices, ajustes };
  } finally {
    await client.end();
  }
}

/**
 * Las plantillas base, en la cuenta de cada inmobiliaria.
 *
 * Es el mismo INSERT que `PlantillasService.sembrar()` —el botón «Traer las
 * base» de la pantalla— con una diferencia: acá el `NOT EXISTS` filtra por
 * `tenant_id`, porque sin RLS el chequeo vería las plantillas de todas las
 * cuentas y la segunda inmobiliaria se quedaría sin ninguna.
 *
 * Se copian a la cuenta en vez de leerse de una tabla global a propósito: cada
 * inmobiliaria las edita con su redacción y su escribanía, y si fueran
 * compartidas, editarlas cambiaría el contrato de las demás.
 */
async function sembrarPlantillas(client: Client, tenantId: string): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO plantilla_doc (tenant_id, tipo, nombre, contenido)
     SELECT $1, x.tipo, x.nombre, x.contenido
       FROM unnest($2::text[], $3::text[], $4::text[]) AS x(tipo, nombre, contenido)
      WHERE NOT EXISTS (
        SELECT 1 FROM plantilla_doc d
         WHERE d.tenant_id = $1 AND d.tipo = x.tipo AND d.nombre = x.nombre
      )
     RETURNING id`,
    [
      tenantId,
      PLANTILLAS_POR_DEFECTO.map((p) => p.tipo),
      PLANTILLAS_POR_DEFECTO.map((p) => p.nombre),
      PLANTILLAS_POR_DEFECTO.map((p) => p.contenido),
    ],
  );
  return rows.length;
}

/**
 * Los avisos, generados con el motor de verdad.
 *
 * Una operación que no está en la base se saltea sin ruido: la base de
 * desarrollo de alguien puede tener el seed a medias, y que eso voltee el
 * arranque sería cambiar una demo incompleta por una API caída.
 */
async function sembrarPublicaciones(client: Client): Promise<number> {
  let creadas = 0;

  for (const p of PUBLICACIONES) {
    const { rows } = await client.query<FilaAviso>(
      `SELECT ${CAMPOS_AVISO}
         FROM operacion o
         JOIN propiedad pr ON pr.id = o.propiedad_id
        WHERE o.id = $1 AND o.tenant_id = $2`,
      [p.operacionId, ANDES],
    );
    if (!rows.length) continue;

    const d = datosParaAviso(rows[0]);
    const { rowCount } = await client.query(
      `INSERT INTO publicacion (id, tenant_id, operacion_id, portal, estado, aviso)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING`,
      [
        p.id,
        ANDES,
        p.operacionId,
        p.portal,
        p.estado,
        JSON.stringify(generarAviso(d.propiedad, d.operacion)),
      ],
    );
    creadas += rowCount ?? 0;
  }

  return creadas;
}

/**
 * Los documentos del legajo, subidos de verdad al bucket.
 *
 * Sube el MISMO PNG committeado en `seeds/archivos/documento-demo.png` —que en
 * la propia imagen dice DOCUMENTO DE EJEMPLO, para que nadie confunda una
 * miniatura de la demo con el DNI de alguien— una vez por casillero, con
 * `AlmacenamientoService.subirImagen()`: las mismas validaciones por firma de
 * bytes, la misma clave con el tenant adelante y la misma URL pública que
 * genera la app. Igual que ya se hace con las plantillas y los avisos.
 *
 * Sin S3 configurado no siembra nada y lo dice: una base de desarrollo sin
 * MinIO es un caso real, y voltear el arranque por eso sería cambiar una demo
 * incompleta por una API caída.
 *
 * ⚠️ Corre como OWNER y **saltea RLS**: cada consulta filtra por `tenant_id` a
 * mano. Sin ese filtro, el `NOT EXISTS` vería los documentos de todas las
 * inmobiliarias de la base.
 */
async function sembrarDocumentosGarantes(
  client: Client,
  log: (msg: string) => void,
): Promise<number> {
  const almacen = new AlmacenamientoService();
  if (!almacen.configurado) {
    log('Seed: sin S3 configurado, los documentos de los garantes quedan sin subir.');
    return 0;
  }

  let png: Buffer;
  try {
    png = await readFile(join(__dirname, '..', '..', 'seeds', 'archivos', 'documento-demo.png'));
  } catch {
    log('Seed: no se encontró seeds/archivos/documento-demo.png; garantes sin documentos.');
    return 0;
  }

  let creados = 0;
  for (const g of DOCUMENTOS_GARANTE) {
    // La garantía puede no estar: una base de desarrollo con el seed a medias
    // es un caso real y saltearla en silencio es mejor que romper el arranque.
    const { rows: existe } = await client.query(
      'SELECT 1 FROM garantia WHERE id = $1 AND tenant_id = $2',
      [g.garantiaId, ANDES],
    );
    if (!existe.length) continue;

    for (const tipo of g.tipos) {
      const { rows: ya } = await client.query(
        `SELECT 1 FROM garantia_documento
          WHERE garantia_id = $1 AND tipo = $2 AND tenant_id = $3`,
        [g.garantiaId, tipo, ANDES],
      );
      if (ya.length) continue;

      const subido = await almacen.subirImagen(
        ANDES, `garantes/${g.garantiaId}`, png, `${tipo}-ejemplo.png`,
      );

      const { rowCount } = await client.query(
        `INSERT INTO garantia_documento
           (tenant_id, garantia_id, tipo, url, nombre_original, subido_por)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [ANDES, g.garantiaId, tipo, subido.url, `${tipo}-ejemplo.png`, OWNER_ANDES],
      );
      creados += rowCount ?? 0;
    }
  }

  return creados;
}

/**
 * La serie de IPC de la demo.
 *
 * ── Por qué hace falta ──────────────────────────────────────────────────────
 *
 * El seed no cargaba **ni un solo** valor de `indice_valor`. El ICL y el UVA los
 * trae el cron del BCRA, así que en una base con red aparecen solos; el IPC no
 * tiene fuente automática —INDEC no publica una API estable y raspar un HTML
 * pondría un número equivocado en un aviso de aumento, decisión ya tomada— y por
 * lo tanto en una base limpia **está vacío**. Con el IPC vacío, un contrato que
 * ajusta por IPC no proyecta un solo aumento y la demo muestra la feature
 * apagada.
 *
 * ── Por qué en TypeScript y no en el .sql ───────────────────────────────────
 *
 * Porque hay que LEER lo que ya está antes de escribir, y decidir con eso.
 * `indice_valor` es **global**: no está scopeada por inmobiliaria, y en una base
 * de desarrollo puede haber valores reales cargados a mano. Si esta serie
 * entrara a ciegas en escala 100 y en algún mes de la ventana ya hubiera un
 * valor real en otra escala, el ajuste que cayera justo ahí calcularía el
 * coeficiente entre dos escalas distintas. Con los números que tiene esta base
 * —IPC 116,53 en 2026-07 contra un demo de 8.400— el alquiler bajaría un 98%.
 *
 * Así que la serie se **ancla a lo que ya hay**: hacia atrás desde el valor más
 * viejo, hacia adelante desde el más nuevo, e interpolando geométricamente los
 * agujeros del medio. Si no hay nada, arranca en 100.
 *
 * ── Por qué NO se siembran ICL ni UVA ───────────────────────────────────────
 *
 * Es una decisión, no un olvido. El cron del BCRA los rellena hasta hoy y
 * `app_indice_cargar` no pisa nada, así que los valores demo quedarían
 * intercalados con los reales y **sólo en los bordes futuros** — que es justo
 * donde el motor va a buscar el último ajuste. Un mes demo entre once reales da
 * un coeficiente absurdo, y encima intermitente: la peor forma de un bug de
 * plata. Sin red (CI, o alguien offline) los dos contratos ICL van a decir
 * «falta el ICL de tal mes», que es exactamente lo que el sistema tiene que
 * decir; se arregla con `POST /v1/indices/sincronizar`.
 *
 * ⚠️ Corre como OWNER. Acá no hace falta filtrar por `tenant_id` —los índices no
 * lo tienen, son dato público— pero sí vale la otra mitad de la advertencia: lo
 * que se escribe acá lo ven TODAS las inmobiliarias de la base.
 */
async function sembrarIpcDemo(client: Client, log: (msg: string) => void): Promise<number> {
  const meses = ventanaDeMeses(MESES_IPC_DEMO);
  if (!meses.length) return 0;

  // `to_char` y no la columna pelada: el parser de `date` a texto lo instala
  // `db.service.ts`, que este archivo no importa. Un `Date` acá volvería a
  // meter la trampa de la medianoche UTC que el repo ya pagó una vez.
  const { rows } = await client.query<{ periodo: string; valor: string }>(
    `SELECT to_char(periodo, 'YYYY-MM-DD') AS periodo, valor::text AS valor
       FROM indice_valor
      WHERE tipo = 'ipc' AND periodo BETWEEN $1::date AND $2::date
      ORDER BY periodo`,
    [meses[0], meses[meses.length - 1]],
  );

  const existentes = new Map(rows.map((r) => [r.periodo, Number(r.valor)]));
  const serie = completarSerie(meses, existentes, PASO_IPC_DEMO);

  let cargados = 0;
  for (const m of meses) {
    if (existentes.has(m)) continue;
    const { rows: r } = await client.query<{ insertado: boolean }>(
      'SELECT insertado FROM app_indice_cargar($1, $2, $3, $4, NULL, NULL)',
      ['ipc', m, serie.get(m), FUENTE_IPC_DEMO],
    );
    if (r[0]?.insertado) cargados++;
  }

  if (cargados) {
    log(
      `Seed: ${cargados} valores de IPC demo entre ${meses[0]} y ${meses[meses.length - 1]}` +
        `${existentes.size ? `, anclados a los ${existentes.size} que ya estaban` : ''}. ` +
        'ICL y UVA no se siembran: los trae el cron del BCRA.',
    );
  }
  return cargados;
}

/** Los primeros de mes desde `M0-n` hasta `M0-1`, inclusive. */
function ventanaDeMeses(n: number): string[] {
  const hoy = new Date();
  const m0 = `${hoy.getUTCFullYear()}-${String(hoy.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const meses: string[] = [];
  for (let k = n; k >= 1; k--) meses.push(sumarMeses(m0, -k));
  return meses;
}

/**
 * Rellena los agujeros de una serie mensual **sin cambiar de escala**.
 *
 * Es lo único que impide que un valor demo y uno real convivan en la misma serie
 * dando un coeficiente absurdo: cada hueco se calcula a partir de sus vecinos
 * reales, no de una escala inventada.
 *
 *   · antes del primero conocido → se divide por el paso, mes a mes
 *   · después del último → se multiplica
 *   · entre dos conocidos → interpolación geométrica entre esos dos, que respeta
 *     los dos extremos exactamente
 *   · sin ningún conocido → arranca en 100, que es como se publica un índice
 */
export function completarSerie(
  meses: string[],
  conocidos: Map<string, number>,
  paso: number,
): Map<string, number> {
  const salida = new Map(conocidos);
  const indicesConocidos = meses
    .map((m, i) => (conocidos.has(m) ? i : -1))
    .filter((i) => i >= 0);

  if (!indicesConocidos.length) {
    let v = 100;
    for (const m of meses) {
      salida.set(m, round2(v));
      v *= paso;
    }
    return salida;
  }

  const primero = indicesConocidos[0];
  const ultimo = indicesConocidos[indicesConocidos.length - 1];

  // Hacia atrás desde el más viejo conocido.
  for (let i = primero - 1; i >= 0; i--) {
    salida.set(meses[i], round2(salida.get(meses[i + 1])! / paso));
  }
  // Hacia adelante desde el más nuevo.
  for (let i = ultimo + 1; i < meses.length; i++) {
    salida.set(meses[i], round2(salida.get(meses[i - 1])! * paso));
  }
  // Los agujeros del medio, entre dos valores que sí existen.
  for (let k = 0; k < indicesConocidos.length - 1; k++) {
    const a = indicesConocidos[k];
    const b = indicesConocidos[k + 1];
    if (b - a <= 1) continue;
    const va = conocidos.get(meses[a])!;
    const vb = conocidos.get(meses[b])!;
    const factor = Math.pow(vb / va, 1 / (b - a));
    for (let i = a + 1; i < b; i++) {
      salida.set(meses[i], round2(va * Math.pow(factor, i - a)));
    }
  }

  return salida;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Los ajustes de los cuatro contratos que proyectan, calculados de verdad.
 *
 * Usa `periodosDeAjuste()` y `calcularAjuste()` —los mismos que
 * `ContratosService.proyectarAjustes()`— y guarda la memoria completa, que es la
 * regla del dominio que no se negocia: todo cálculo lleva su memoria o el
 * aumento no se le puede explicar al inquilino.
 *
 * Se corta en el primer mes sin índice, igual que la aplicación: sin ese ajuste
 * no se puede encadenar el siguiente, y **estimarlo está prohibido**. Con las
 * fechas del `.sql` eso pasa siempre en el cuarto, así que la demo muestra tres
 * aumentos reales y un «falta el índice de tal mes» que también hay que ver.
 *
 * ⚠️ Corre como OWNER y saltea RLS: cada consulta filtra por `tenant_id`.
 */
async function proyectarAjustesDemo(
  client: Client,
  log: (msg: string) => void,
): Promise<number> {
  let creados = 0;
  const faltantes: string[] = [];

  for (const contratoId of CONTRATOS_QUE_PROYECTAN) {
    const { rows } = await client.query<{
      moneda: string; indice: TipoIndice; periodicidad_meses: number;
      monto_inicial: string; fecha_inicio: string; fecha_fin: string; mes_base: string;
    }>(
      `SELECT moneda, indice, periodicidad_meses, monto_inicial::text,
              to_char(fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,
              to_char(fecha_fin,'YYYY-MM-DD')    AS fecha_fin,
              to_char(mes_base,'YYYY-MM-DD')     AS mes_base
         FROM contrato_alquiler
        WHERE id = $1 AND tenant_id = $2`,
      [contratoId, ANDES],
    );
    // Una base con el seed a medias es un caso real: saltear en silencio es
    // mejor que voltear el arranque de la API.
    if (!rows.length) continue;
    const c = rows[0];

    // El mismo límite que la app: hasta un período por delante de hoy. Más allá
    // los índices ni siquiera existen.
    const hoy = new Date();
    const m0 = `${hoy.getUTCFullYear()}-${String(hoy.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const limite = sumarMeses(m0, c.periodicidad_meses);

    const cadena = periodosDeAjuste(
      c.fecha_inicio, c.fecha_fin, c.periodicidad_meses, c.mes_base, limite,
    );

    let montoVigente = Number(c.monto_inicial);

    for (const p of cadena) {
      const { rows: ya } = await client.query(
        'SELECT 1 FROM contrato_ajuste WHERE contrato_id = $1 AND vigente_desde = $2::date',
        [contratoId, p.vigenteDesde],
      );
      if (ya.length) continue;

      const valorBase = await valorIndice(client, c.indice, p.periodoBase);
      const valorActual = await valorIndice(client, c.indice, p.periodoActual);
      if (valorBase === null || valorActual === null) {
        faltantes.push(`${c.indice.toUpperCase()} ${p.periodoActual.slice(0, 7)}`);
        break;
      }

      let r;
      try {
        r = calcularAjuste({
          montoVigente,
          moneda: c.moneda,
          indice: c.indice,
          valorBase,
          valorActual,
          periodoBase: p.periodoBase,
          periodoActual: p.periodoActual,
        });
      } catch (err) {
        if (err instanceof AjusteImposible) break;
        throw err;
      }

      const { rowCount } = await client.query(
        `INSERT INTO contrato_ajuste (
           tenant_id, contrato_id, vigente_desde, periodo_base, periodo_actual,
           indice_tipo, valor_base, valor_actual, coeficiente,
           monto_anterior, monto_nuevo, moneda, memoria)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (contrato_id, vigente_desde) DO NOTHING`,
        [
          ANDES, contratoId, p.vigenteDesde, p.periodoBase, p.periodoActual,
          c.indice, valorBase, valorActual, r.coeficiente,
          montoVigente, r.montoNuevo, c.moneda,
          JSON.stringify({ ...r.memoria, explicacion: r.explicacion }),
        ],
      );

      creados += rowCount ?? 0;
      montoVigente = r.montoNuevo;
    }
  }

  if (faltantes.length) {
    log(
      `Seed: los ajustes se cortaron donde falta el índice (${[...new Set(faltantes)].join(', ')}). ` +
        'Es lo correcto: el sistema no estima un índice que no se publicó. ' +
        'Si es ICL o UVA, se destraba con POST /v1/indices/sincronizar.',
    );
  }
  return creados;
}

async function valorIndice(
  client: Client,
  tipo: string,
  periodo: string,
): Promise<number | null> {
  const { rows } = await client.query<{ valor: string }>(
    "SELECT valor::text AS valor FROM indice_valor WHERE tipo = $1 AND periodo = date_trunc('month', $2::date)",
    [tipo, periodo],
  );
  return rows.length ? Number(rows[0].valor) : null;
}
