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
  DEMASIADOS_INTENTOS: 'DEMASIADOS_INTENTOS',

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
  INDICE_YA_CARGADO: 'INDICE_YA_CARGADO',
  COTIZACION_YA_CARGADA: 'COTIZACION_YA_CARGADA',
  SIN_INDICE: 'SIN_INDICE',
  AJUSTE_YA_CONFIRMADO: 'AJUSTE_YA_CONFIRMADO',
  SIN_AJUSTE: 'SIN_AJUSTE',
  PERIODO_YA_PAGADO: 'PERIODO_YA_PAGADO',
  NO_ADMINISTRADO: 'NO_ADMINISTRADO',

  // Planes
  LIMITE_DE_PLAN: 'LIMITE_DE_PLAN',
  MODULO_NO_INCLUIDO: 'MODULO_NO_INCLUIDO',

  // Reglas de inmutabilidad que hace cumplir la BASE con SQLSTATE 'BE002': un
  // gasto ya rendido, igual que un ajuste confirmado o una liquidación cerrada.
  // El código es estable para que el front decida sin leer el texto.
  YA_RENDIDO: 'YA_RENDIDO',

  // Una referencia que no es de esta inmobiliaria, o que no existe. Las dos
  // cosas comparten código A PROPÓSITO: distinguirlas le confirmaría a quien
  // prueba ids que ese id existe del otro lado. Ver migración 035.
  REFERENCIA_INVALIDA: 'REFERENCIA_INVALIDA',

  // Archivos
  ALMACENAMIENTO_NO_CONFIGURADO: 'ALMACENAMIENTO_NO_CONFIGURADO',
  ARCHIVO_DEMASIADO_GRANDE: 'ARCHIVO_DEMASIADO_GRANDE',
  FORMATO_NO_SOPORTADO: 'FORMATO_NO_SOPORTADO',
  DEMASIADAS_FOTOS: 'DEMASIADAS_FOTOS',
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
