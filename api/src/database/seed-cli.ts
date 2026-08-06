import { loadEnv } from '../config/env';
import { sembrarDemo } from './seed';

async function main(): Promise<void> {
  const env = loadEnv();

  if (env.isProduction) {
    throw new Error('El seed de datos demo no corre en producción.');
  }

  const { plantillas, publicaciones } = await sembrarDemo(env.DATABASE_OWNER_URL);

  // El seed es idempotente y corre en cada arranque de dev (`SEED_ON_BOOT`),
  // así que decir "aplicado" no significa "insertado": la segunda corrida no
  // toca nada. Se informa lo que quedó en la base, que es lo comprobable.
  console.log(
    'Seed demo aplicado. 2 inmobiliarias, 16 propiedades, 15 contratos y su ' +
      'ciclo de cobranza, más las plantillas base y los avisos de la cartera ' +
      `(${plantillas} plantillas y ${publicaciones} avisos nuevos en esta corrida). ` +
      'Se entra con `owner@andes.test`, contraseña `unaclavelarga1`.',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
