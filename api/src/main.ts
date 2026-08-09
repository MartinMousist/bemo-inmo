import 'reflect-metadata';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { configurarApp } from './configurar-app';
import { migrar } from './database/migrator';
import { convertirPlantillasAHtml } from './database/convertir-plantillas';
import { sembrarDemo } from './database/seed';

async function bootstrap(): Promise<void> {
  // Primero de todo: si el entorno está incompleto, morimos acá y no a mitad
  // del primer request.
  const env = loadEnv();
  const logger = new Logger('Bootstrap');

  if (env.MIGRATE_ON_BOOT) {
    const { aplicadas, yaEstaban } = await migrar(
      env.DATABASE_OWNER_URL,
      join(__dirname, '..', 'migrations'),
      (m) => logger.log(m),
    );
    logger.log(`Migraciones: ${aplicadas.length} nuevas, ${yaEstaban} ya estaban`);

    // El paso de datos de la 023: las plantillas viejas, de texto plano al HTML
    // del editor. Va con las migraciones y no con el seed porque no es un dato
    // de demostración: es el contenido real de cada inmobiliaria. Idempotente.
    const conv = await convertirPlantillasAHtml(env.DATABASE_OWNER_URL, (m) => logger.log(m));
    if (conv.convertidas) logger.log(`Plantillas convertidas a HTML: ${conv.convertidas}`);
  }

  if (env.SEED_ON_BOOT) {
    // El seed NO puede voltear la API. Son datos de demostración: que fallen es
    // un problema de la demo, no de la aplicación, y dejar el backend caído por
    // eso convierte una molestia en una mañana perdida.
    //
    // No es hipotético: al ampliar el seed, un `owner@prueba.test` que ya
    // existía en la base de desarrollo hizo que `usuario_email_key` reventara
    // en cada arranque, y la API quedó en un ciclo de reinicio con el front
    // dando `ERR_CONNECTION_RESET`. El error decía "duplicate key" y no decía
    // "es el seed", que es la parte que costó.
    //
    // Las migraciones sí frenan el arranque, a propósito: una base con el
    // esquema viejo no es una molestia, es corrupción esperando pasar.
    try {
      await sembrarDemo(env.DATABASE_OWNER_URL, (m) => logger.log(m));
    } catch (err) {
      logger.warn(
        `El seed demo no se pudo aplicar y la API arranca igual: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });

  configurarApp(app);

  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`Bemo INMO API escuchando en :${env.PORT}/v1 (${env.NODE_ENV})`);
}

bootstrap().catch((err) => {
  // Sin logger de Nest: puede haber fallado antes de que exista la app.
  console.error('\nLa API no pudo arrancar:\n');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
