/**
 * Catálogo de códigos de error estables.
 *
 * El front lee `code`, nunca `detail`. `detail` es texto para mostrarle a una
 * persona y puede cambiar de redacción sin aviso; `code` es contrato y cambiarlo
 * rompe clientes. Cada código nuevo se agrega acá y en ningún otro lado.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  TENANT_CONTEXT_MISSING: 'TENANT_CONTEXT_MISSING',
  DB_UNAVAILABLE: 'DB_UNAVAILABLE',
  INTERNAL: 'INTERNAL',

  // Auth
  CREDENCIALES_INVALIDAS: 'CREDENCIALES_INVALIDAS',
  EMAIL_EN_USO: 'EMAIL_EN_USO',
  SIN_MEMBRESIA: 'SIN_MEMBRESIA',
  SESION_INVALIDA: 'SESION_INVALIDA',
  SESION_COMPROMETIDA: 'SESION_COMPROMETIDA',
  INVITACION_INVALIDA: 'INVITACION_INVALIDA',

  // Dominio
  DOCUMENTO_DUPLICADO: 'DOCUMENTO_DUPLICADO',
  EN_USO: 'EN_USO',
  OPERACION_DUPLICADA: 'OPERACION_DUPLICADA',
  TITULARIDAD_INVALIDA: 'TITULARIDAD_INVALIDA',
  RESERVA_ACTIVA: 'RESERVA_ACTIVA',
  CONTRATO_SOLAPADO: 'CONTRATO_SOLAPADO',
  INDICE_NO_DISPONIBLE: 'INDICE_NO_DISPONIBLE',
  AJUSTE_INMUTABLE: 'AJUSTE_INMUTABLE',
  LIQUIDACION_CERRADA: 'LIQUIDACION_CERRADA',
  ESTADO_INVALIDO: 'ESTADO_INVALIDO',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCodeValue,
    readonly detail: string,
    readonly title?: string,
  ) {
    super(detail);
    this.name = 'AppError';
  }

  static notFound(detail: string): AppError {
    return new AppError(404, ErrorCode.NOT_FOUND, detail, 'Not Found');
  }

  static forbidden(detail: string): AppError {
    return new AppError(403, ErrorCode.FORBIDDEN, detail, 'Forbidden');
  }

  static tenantContextMissing(): AppError {
    return new AppError(
      500,
      ErrorCode.TENANT_CONTEXT_MISSING,
      'La operación requiere contexto de inmobiliaria y no se fijó ninguno.',
      'Internal Server Error',
    );
  }
}
