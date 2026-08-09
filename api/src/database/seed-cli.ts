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
  //
  // El inventario viene CONTADO de la base (`r.cartera`), no escrito a mano.
  // Estaba a mano y decía «20 propiedades»: era cierto hasta que
  // `demo-cartera.sql` sumó dieciséis unidades ofrecidas y nadie tocó el
  // mensaje. Un número fijo en un texto que informa un inventario envejece sin
  // avisar, y acá el que lo lee es el que después no encuentra lo que el seed
  // le prometió.
  const c = r.cartera;
  console.log(
    `Seed demo aplicado. 2 inmobiliarias, ${c.propiedades} propiedades, ` +
      `${c.personas} personas y ${c.contratos} contratos con su ciclo de cobranza. ` +
      `Cartera ofrecida: ${c.ofrecidasVenta} en venta y ${c.ofrecidasAlquiler} en ` +
      `alquiler, con ${c.oportunidades} oportunidades encima. Más las plantillas ` +
      'base, los avisos de la cartera, cinco garantías con su legajo y los cuatro ' +
      'contratos ICL/IPC que proyectan sus aumentos ' +
      `(${r.plantillas} plantillas, ${r.publicaciones} avisos, ` +
      `${r.documentos} documentos, ${r.fotos} fotos de propiedades, ` +
      `${r.indices} valores de IPC demo y ${r.ajustes} ajustes nuevos en esta corrida). ` +
      'Se entra con `owner@andes.test`, contraseña `unaclavelarga1`.',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
