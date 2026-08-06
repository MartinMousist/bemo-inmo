import { join } from 'node:path';
import { Client } from 'pg';
import { correrSql } from './migrator';
import { PLANTILLAS_POR_DEFECTO } from '../plantillas/plantillas.defecto';
import { generarAviso } from '../publicaciones/aviso.motor';
import { CAMPOS_AVISO, datosParaAviso, type FilaAviso } from '../publicaciones/publicaciones.datos';

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

export interface ResultadoSeed {
  plantillas: number;
  publicaciones: number;
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

    log(
      `Seed demo aplicado. Plantillas nuevas: ${plantillas}. ` +
        `Avisos nuevos: ${publicaciones}.`,
    );
    return { plantillas, publicaciones };
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
