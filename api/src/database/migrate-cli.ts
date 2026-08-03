import { join } from 'node:path';
import { loadEnv } from '../config/env';
import { migrar } from './migrator';

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
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
