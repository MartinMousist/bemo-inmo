import { join } from 'node:path';
import { loadEnv } from '../config/env';
import { correrSql } from './migrator';

async function main(): Promise<void> {
  const env = loadEnv();

  if (env.isProduction) {
    throw new Error('El seed de datos demo no corre en producción.');
  }

  await correrSql(env.DATABASE_OWNER_URL, join(__dirname, '..', '..', 'seeds', 'demo.sql'));

  // El seed es idempotente y corre en cada arranque de dev (`SEED_ON_BOOT`),
  // así que decir "aplicado" no significa "insertado": la segunda corrida no
  // toca nada. Se informa lo que quedó en la base, que es lo comprobable.
  console.log(
    'Seed demo aplicado. 2 inmobiliarias, 16 propiedades, 15 contratos y su ' +
      'ciclo de cobranza. Usuarios `*@prueba.test`, contraseña `unaclavelarga1`.',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
