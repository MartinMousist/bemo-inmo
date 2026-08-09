import { Client } from 'pg';
import { textoAHtml } from '../plantillas/plantillas.html';

/**
 * La conversión de las plantillas de texto plano a HTML.
 *
 * ── Por qué esto NO va adentro del `.sql` de la 023 ─────────────────────────
 *
 * Porque la conversión no es un `UPDATE`: es un parser que arma un árbol de
 * `{% si %}` / `{% para %}`, respeta las viñetas, salva el indentado del bloque
 * de firmas y envuelve cada `{{ }}` en su chip. Escribir eso en PL/pgSQL sería
 * una segunda implementación del mismo conversor, que se iría desincronizando
 * de `plantillas.html.ts` — la que sí se prueba con casos de papel.
 *
 * Es el mismo patrón que ya usa `seed.ts` para las plantillas y los avisos, y
 * por el mismo motivo: el texto legal no se copia adentro de un `.sql`.
 *
 * ── Corre como OWNER y saltea RLS: acá eso es LO QUE SE QUIERE ──────────────
 *
 * En el seed, saltear RLS es la trampa que una vez marcó como pagadas siete
 * cuotas de una inmobiliaria ajena, y por eso allá se filtra por `tenant_id` a
 * mano. Acá es al revés: hay que convertir las plantillas de TODAS las
 * inmobiliarias, porque es un cambio de esquema de datos y no una operación de
 * negocio de ninguna de ellas. Se dice explícito para que nadie «arregle» esto
 * agregándole un filtro.
 *
 * ── Idempotente ────────────────────────────────────────────────────────────
 *
 * Sólo toca `contenido_formato = 'texto'`. Correrla dos veces no convierte dos
 * veces —lo que escaparía las etiquetas de la primera pasada y dejaría
 * `&lt;p&gt;` impreso adentro del contrato—.
 */
export interface ResultadoConversion {
  convertidas: number;
  yaEstaban: number;
}

export async function convertirPlantillasAHtml(
  ownerUrl: string,
  log: (msg: string) => void = () => undefined,
): Promise<ResultadoConversion> {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();

  try {
    // La columna existe recién a partir de la 023. Si alguien corre este paso
    // contra una base vieja, se dice y se sale, en vez de tirar un error de
    // SQL que no explica nada.
    const { rows: hayColumna } = await client.query<{ existe: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_name = 'plantilla_doc' AND column_name = 'contenido_formato'
       ) AS existe`,
    );
    if (!hayColumna[0]?.existe) {
      log('  plantillas: la 023 todavía no está aplicada, no hay nada que convertir.');
      return { convertidas: 0, yaEstaban: 0 };
    }

    const { rows } = await client.query<{ id: string; contenido: string }>(
      `SELECT id, contenido FROM plantilla_doc WHERE contenido_formato = 'texto'`,
    );
    const { rows: ya } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM plantilla_doc WHERE contenido_formato = 'html'`,
    );

    for (const p of rows) {
      const html = textoAHtml(p.contenido);
      await client.query(
        `UPDATE plantilla_doc
            SET contenido = $2,
                contenido_texto_original = contenido,
                contenido_formato = 'html',
                convertida_el = now()
          WHERE id = $1`,
        [p.id, html],
      );
    }

    if (rows.length) log(`  convertidas ${rows.length} plantilla(s) a HTML.`);
    return { convertidas: rows.length, yaEstaban: Number(ya[0]?.n ?? 0) };
  } finally {
    await client.end();
  }
}
