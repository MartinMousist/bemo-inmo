import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError, ErrorCode, type ErrorCodeValue } from './app-error';

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: ErrorCodeValue | string;
  instance: string;
}

/**
 * Contrato de error único (RFC 9457). Toda excepción sale con la misma forma.
 *
 * Los 500 se registran con su stack. Un error que sólo se serializa al cliente
 * es un error invisible: no aparece en ningún log y nadie se entera de que pasó.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const problem = this.toProblem(exception, req.originalUrl ?? req.url);

    if (problem.status >= 500) {
      this.logger.error(
        `${problem.code} ${req.method} ${problem.instance} — ${problem.detail}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res
      .status(problem.status)
      .type('application/problem+json')
      .json(problem);
  }

  private toProblem(exception: unknown, instance: string): ProblemDetails {
    if (exception instanceof AppError) {
      return {
        type: 'about:blank',
        title: exception.title ?? statusTitle(exception.status),
        status: exception.status,
        detail: exception.detail,
        code: exception.code,
        instance,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      return {
        type: 'about:blank',
        title: statusTitle(status),
        status,
        detail: extractDetail(body, exception.message),
        code: inferCode(status),
        instance,
      };
    }

    // Los límites de plan los levanta un trigger con SQLSTATE 'BE001'. El
    // mensaje ya viene redactado desde la base, que es el único lugar donde
    // vive el límite: se pasa tal cual en vez de reescribirlo acá.
    if (esLimiteDePlan(exception)) {
      return {
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: (exception as { message: string }).message,
        code: ErrorCode.LIMITE_DE_PLAN,
        instance,
      };
    }

    // Nada más llega acá: cualquier cosa inesperada es un 500 genérico hacia
    // afuera. El detalle real va al log, no al cliente.
    return {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'Ocurrió un error inesperado.',
      code: ErrorCode.INTERNAL,
      instance,
    };
  }
}

/** SQLSTATE propio del proyecto para topes de plan. Ver migración 012. */
function esLimiteDePlan(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'BE001'
  );
}

function extractDetail(body: unknown, fallback: string): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (Array.isArray(m)) return m.join('; ');
    if (typeof m === 'string') return m;
  }
  return fallback;
}

function inferCode(status: number): ErrorCodeValue {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return ErrorCode.VALIDATION_FAILED;
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrorCode.NOT_FOUND;
    default:
      return ErrorCode.INTERNAL;
  }
}

function statusTitle(status: number): string {
  const name = Object.entries(HttpStatus).find(([, v]) => v === status)?.[0];
  if (!name) return 'Error';
  return name
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
