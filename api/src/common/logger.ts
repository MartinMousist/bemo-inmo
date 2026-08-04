import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { contextoActual } from './request-id';

/**
 * Logger JSON, una línea por evento.
 *
 * En desarrollo se sigue viendo el formato lindo de Nest: leer JSON a mano
 * mientras se programa es una molestia sin beneficio. En producción sale JSON,
 * que es lo único que un agregador puede filtrar por `requestId` o por `tenantId`
 * sin adivinar con expresiones regulares.
 *
 * **Lo que nunca entra en un log**: contraseñas, tokens, hashes, ni el cuerpo de
 * un request. Acá se registran identificadores y nombres de eventos. Un log con
 * datos de una inmobiliaria adentro es una fuga esperando a que alguien tenga
 * acceso a los logs y no a la base.
 */
export class LoggerJson extends ConsoleLogger {
  constructor(private readonly comoJson: boolean) {
    super();
  }

  log(mensaje: unknown, ...rest: unknown[]): void {
    this.emitir('log', mensaje, rest, () => super.log(mensaje as string, ...(rest as string[])));
  }

  warn(mensaje: unknown, ...rest: unknown[]): void {
    this.emitir('warn', mensaje, rest, () => super.warn(mensaje as string, ...(rest as string[])));
  }

  error(mensaje: unknown, ...rest: unknown[]): void {
    this.emitir('error', mensaje, rest, () => super.error(mensaje as string, ...(rest as string[])));
  }

  debug(mensaje: unknown, ...rest: unknown[]): void {
    this.emitir('debug', mensaje, rest, () => super.debug(mensaje as string, ...(rest as string[])));
  }

  verbose(mensaje: unknown, ...rest: unknown[]): void {
    this.emitir('verbose', mensaje, rest, () =>
      super.verbose(mensaje as string, ...(rest as string[])),
    );
  }

  private emitir(
    nivel: LogLevel,
    mensaje: unknown,
    rest: unknown[],
    enLindo: () => void,
  ): void {
    if (!this.comoJson) {
      enLindo();
      return;
    }

    const ctx = contextoActual();
    // El último argumento de Nest suele ser el nombre del contexto ('Db',
    // 'Error'…); el anteúltimo, un stack. Se separan para que el JSON tenga
    // campos y no un choclo de texto.
    const contexto = typeof rest.at(-1) === 'string' ? (rest.at(-1) as string) : undefined;
    const stack = rest.length > 1 && typeof rest[0] === 'string' ? rest[0] : undefined;

    process.stdout.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        nivel,
        mensaje: typeof mensaje === 'string' ? mensaje : JSON.stringify(mensaje),
        contexto,
        requestId: ctx?.requestId,
        tenantId: ctx?.tenantId,
        usuarioId: ctx?.usuarioId,
        metodo: ctx?.metodo,
        ruta: ctx?.ruta,
        ...(stack ? { stack } : {}),
      }) + '\n',
    );
  }
}
