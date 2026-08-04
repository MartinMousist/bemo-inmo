import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Un identificador por request, y un log que se puede seguir.
 *
 * Sin esto, diagnosticar algo en producción es `grep` sobre renglones sueltos
 * sin forma de atar los de un mismo request: con dos usuarios trabajando a la
 * vez, las líneas se intercalan y no hay manera de saber cuáles van juntas.
 *
 * El id viaja en tres lados:
 *  - en el header `X-Request-Id` de la respuesta,
 *  - en el cuerpo del error (RFC 9457 permite campos propios),
 *  - y en cada línea de log de ese request.
 *
 * Así, cuando alguien dice "me dio error", el id que ve en pantalla es el mismo
 * que se busca en el log. Es la diferencia entre "reproducilo" y "ya lo veo".
 */

interface Contexto {
  requestId: string;
  metodo: string;
  ruta: string;
  /** Se completa cuando el guard resuelve la sesión. */
  tenantId?: string;
  usuarioId?: string;
}

/**
 * `AsyncLocalStorage` y no un parámetro que se pasa a mano por veinte capas: el
 * contexto tiene que estar disponible en el logger sin que cada servicio tenga
 * que recibirlo y reenviarlo. Es exactamente para lo que existe.
 */
const almacen = new AsyncLocalStorage<Contexto>();

export function contextoActual(): Contexto | undefined {
  return almacen.getStore();
}

export function requestIdActual(): string | undefined {
  return almacen.getStore()?.requestId;
}

/**
 * Completa el contexto con quién es. Lo llama el guard, cuando ya validó el
 * token: antes de eso no se sabe, y adivinarlo sería peor que no ponerlo.
 */
export function anotarActor(tenantId: string, usuarioId: string): void {
  const ctx = almacen.getStore();
  if (ctx) {
    ctx.tenantId = tenantId;
    ctx.usuarioId = usuarioId;
  }
}

const HEADER = 'x-request-id';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Si viene de afuera se respeta: así una traza que arranca en un proxy o en
  // otro servicio sigue siendo la misma de punta a punta. Se acota el largo
  // porque es un valor de un tercero y termina en los logs.
  const entrante = req.headers[HEADER];
  const heredado =
    typeof entrante === 'string' && entrante.length > 0 && entrante.length <= 200
      ? entrante
      : null;

  const requestId = heredado ?? randomUUID();
  res.setHeader('X-Request-Id', requestId);

  almacen.run(
    { requestId, metodo: req.method, ruta: req.originalUrl ?? req.url },
    () => next(),
  );
}
