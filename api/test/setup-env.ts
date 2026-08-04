// Entorno de los tests. Apunta a la MISMA base que levanta docker compose y corre
// las MISMAS migraciones que producción. Un schema armado a mano para los tests
// prueba otra cosa que la que se despliega.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://inmo_app:cambiame_app@localhost:5432/bemo_inmo';
process.env.DATABASE_OWNER_URL ??=
  'postgres://inmo_owner:cambiame_owner@localhost:5432/bemo_inmo';
process.env.MIGRATE_ON_BOOT = 'false';
process.env.SEED_ON_BOOT = 'false';

// El límite de intentos de /auth se afloja para el resto de la suite: 300 tests
// contra 127.0.0.1 comparten IP, y el tope real (10 por ventana) los cortaría por
// un motivo que no es el que cada test está probando. Quien prueba el límite es
// `rate-limit.spec.ts`, que se baja los topes a mano antes de levantar la app.
process.env.RATE_LIMIT_LOGIN_IP ??= '10000';
process.env.RATE_LIMIT_LOGIN_CUENTA ??= '10000';
process.env.RATE_LIMIT_REGISTRO_IP ??= '10000';
process.env.RATE_LIMIT_REFRESH_IP ??= '10000';
