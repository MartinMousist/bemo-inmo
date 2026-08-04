import 'reflect-metadata';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { configurarApp } from './configurar-app';
import { migrar, correrSql } from './database/migrator';

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
  }

  if (env.SEED_ON_BOOT) {
    await correrSql(env.DATABASE_OWNER_URL, join(__dirname, '..', 'seeds', 'demo.sql'));
    logger.log('Seed demo aplicado');
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
