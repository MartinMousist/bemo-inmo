import { join } from 'node:path';
import { loadEnv } from '../config/env';
import { migrar } from './migrator';
import { convertirPlantillasAHtml } from './convertir-plantillas';

async function main(): Promise<void> {
  const env = loadEnv();
  const dir = join(__dirname, '..', '..', 'migrations');

  console.log('Migrando…');
  const { aplicadas, yaEstaban } = await migrar(env.DATABASE_OWNER_URL, dir, (m) =>
    console.log(m),
  );

  console.log(
    aplicadas.length
      ? `${aplicadas.length} migración(es) aplicada(s), ${yaEstaban} ya estaban.`
      : `Nada que hacer: las ${yaEstaban} migraciones ya estaban aplicadas.`,
  );

  // El paso de datos de la 023. Va DESPUÉS del `.sql` y no adentro: es un
  // parser con casos de papel, no un UPDATE. Idempotente: sólo toca las que
  // siguen en `contenido_formato = 'texto'`.
  const conv = await convertirPlantillasAHtml(env.DATABASE_OWNER_URL, (m) => console.log(m));
  if (!conv.convertidas) {
    console.log(`Plantillas: nada que convertir (${conv.yaEstaban} ya están en HTML).`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
