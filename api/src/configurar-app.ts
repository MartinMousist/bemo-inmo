import { BadRequestException, ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import express from 'express';
import cookieParser from 'cookie-parser';
import { loadEnv } from './config/env';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { requestIdMiddleware } from './common/request-id';
import { LoggerJson } from './common/logger';
import { ErrorCode } from './common/app-error';

/**
 * TODA la configuración de la app, en un solo lugar.
 *
 * Existe porque estaba duplicada entre `main.ts` y el arnés de tests, y se
 * desincronizó: el arnés no tenía `helmet`, así que la suite corría contra una
 * app que no era la que se despliega. La revisión de seguridad lo encontró.
 *
 * El playbook lo dice: levantá la app REAL, mismo módulo, mismos pipes, mismo
 * filtro de errores. Con dos copias de la configuración eso dura hasta el
 * primer cambio en una sola de las dos.
 */
export function configurarApp(app: INestApplication): void {
  const env = loadEnv();

  // JSON en producción, formato legible mientras se programa. Leer JSON a mano
  // en la consola es una molestia sin beneficio; filtrar texto libre por
  // requestId en un agregador es imposible.
  app.useLogger(new LoggerJson(env.LOG_JSON));

  app.use(helmet());
  app.use(cookieParser());

  // PRIMERO de todo lo que registra algo: si fuera después, los errores del
  // parseo de body saldrían sin id y son justo los que cuesta reproducir.
  app.use(requestIdMiddleware);

  // Las fotos viajan en base64, que infla un 33%: una imagen de 8 MB son ~11 MB
  // de JSON. El límite grande va SÓLO en esa ruta; subirlo para todo agrandaría
  // la superficie de ataque de cada endpoint por una necesidad de uno.
  app.use('/v1/propiedades/:id/fotos', express.json({ limit: env.BODY_LIMIT_FOTOS }));
  // Los documentos del garante son lo mismo: la foto del DNI que alguien saca
  // con el teléfono pasa los 3 MB sin esfuerzo, y con el límite normal el
  // legajo no se puede cargar. Es la trampa del `BODY_LIMIT` de 1 MB otra vez
  // —la que no se vio antes porque el test usaba un PNG de 2×2.
  app.use('/v1/garantes/:id/documentos', express.json({ limit: env.BODY_LIMIT_FOTOS }));
  // La importación CSV manda texto plano, también más grande que lo normal.
  app.use('/v1/importar', express.json({ limit: env.BODY_LIMIT_IMPORTAR }));

  app.use(express.json({ limit: env.BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: env.BODY_LIMIT }));

  // Para que req.ip sea la IP real detrás del proxy. La auditoría con la IP
  // equivocada es peor que sin IP.
  (app as NestExpressApplication).set('trust proxy', 1);

  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Un cliente que manda `rol: "owner"` se entera, y nosotros también.
      // Ignorar el campo en silencio es lo peligroso.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },

      /**
       * Ningún mensaje de class-validator es texto de interfaz.
       *
       * Por default salen en inglés y con el nombre de la propiedad tal como
       * está en el DTO: «porPagina must not be greater than 100». Eso terminó
       * impreso en la pantalla de Vencimientos —el defecto B-01 de la etapa 11—
       * y era la punta visible del problema: un `detail` de librería llegando
       * al usuario.
       *
       * El contrato RFC 9457 tiene `code` estable justamente para que el front
       * decida sin leer el texto. Acá se redacta el `detail`, en castellano y
       * sin nombres de campo internos, y se deja el detalle técnico en
       * `errores` para diagnosticar.
       */
      exceptionFactory: (errores) => {
        const campos = errores.map((e) => e.property);
        const detail =
          campos.length === 1
            ? `El campo «${campos[0]}» no es válido.`
            : `Hay ${campos.length} campos con datos que no se pueden usar: ${campos.join(', ')}.`;

        return new BadRequestException({
          // `message` y no `detail`: es la clave que lee `extractDetail` del
          // filtro, que sigue la convención de Nest. Poner `detail` acá deja el
          // mensaje redactado sin usar y saca «Bad Request Exception» — que es
          // exactamente el texto de librería que esto vino a sacar.
          message: detail,
          code: ErrorCode.VALIDATION_FAILED,
          // Para el log y para quien esté integrando contra la API, no para la
          // pantalla. El front muestra `detail`.
          errores: errores.map((e) => ({
            campo: e.property,
            reglas: Object.keys(e.constraints ?? {}),
          })),
        });
      },
    }),
  );

  app.enableCors({ origin: env.CORS_ORIGIN, credentials: true });
  app.enableShutdownHooks();
}
