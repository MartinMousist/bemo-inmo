// Entorno de los tests. Apunta a la MISMA base que levanta docker compose y corre
// las MISMAS migraciones que producción. Un schema armado a mano para los tests
// prueba otra cosa que la que se despliega.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://inmo_app:cambiame_app@localhost:5432/bemo_inmo';
process.env.DATABASE_OWNER_URL ??=
  'postgres://inmo_owner:cambiame_owner@localhost:5432/bemo_inmo';
process.env.MIGRATE_ON_BOOT = 'false';
process.env.SEED_ON_BOOT = 'false';
