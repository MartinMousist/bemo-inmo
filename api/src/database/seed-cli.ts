import { loadEnv } from '../config/env';
import { sembrarDemo } from './seed';

async function main(): Promise<void> {
  const env = loadEnv();

  if (env.isProduction) {
    throw new Error('El seed de datos demo no corre en producción.');
  }

  const r = await sembrarDemo(env.DATABASE_OWNER_URL, (m) => console.log(m));

  // El seed es idempotente y corre en cada arranque de dev (`SEED_ON_BOOT`),
  // así que decir "aplicado" no significa "insertado": la segunda corrida no
  // toca nada. Se informa lo que quedó en la base, que es lo comprobable.
  console.log(
    'Seed demo aplicado. 2 inmobiliarias, 20 propiedades, 19 contratos y su ' +
      'ciclo de cobranza, más las plantillas base, los avisos de la cartera, ' +
      'cinco garantías con su legajo y los cuatro contratos ICL/IPC que proyectan ' +
      `sus aumentos (${r.plantillas} plantillas, ${r.publicaciones} avisos, ` +
      `${r.documentos} documentos, ${r.indices} valores de IPC demo y ${r.ajustes} ` +
      'ajustes nuevos en esta corrida). ' +
      'Se entra con `owner@andes.test`, contraseña `unaclavelarga1`.',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
