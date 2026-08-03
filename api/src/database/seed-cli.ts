import { join } from 'node:path';
import { loadEnv } from '../config/env';
import { correrSql } from './migrator';

async function main(): Promise<void> {
  const env = loadEnv();

  if (env.isProduction) {
    throw new Error('El seed de datos demo no corre en producción.');
  }

  await correrSql(env.DATABASE_OWNER_URL, join(__dirname, '..', '..', 'seeds', 'demo.sql'));
  console.log('Seed demo aplicado: 2 inmobiliarias.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
