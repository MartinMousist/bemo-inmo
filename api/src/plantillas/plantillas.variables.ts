/**
 * El catálogo de variables que ofrece el menú del editor.
 *
 * ── Por qué vive en la API y no en `web/` ───────────────────────────────────
 *
 * Porque el contexto lo arma `contextoDeContrato()`, cinco archivos más allá,
 * con un `SELECT` de sesenta líneas. Un catálogo escrito en el front se
 * desincroniza de ese `SELECT` en la primera sesión en que alguien agregue un
 * campo, y entonces el menú **ofrece variables que no existen**: la persona
 * inserta «Piso», el documento sale con ««propiedad.piso»» entre comillas
 * angulares y nadie entiende por qué. Acá al lado, con un test que confronta el
 * catálogo contra el contexto de ejemplo en las DOS direcciones, eso no se
 * puede escapar.
 *
 * ── Qué es cada campo ───────────────────────────────────────────────────────
 *
 * · `ruta` es lo único que el motor entiende. El resto es para la persona.
 * · `etiqueta` es lo que se lee en el menú: «Precio mensual», no
 *   `contrato.monto`. Quien redacta un contrato no tiene por qué saber cómo se
 *   llama una columna.
 * · `ejemplo` es lo que se va a ver impreso, ya formateado. Es la diferencia
 *   entre elegir a ciegas y elegir mirando.
 * · `formatos` son los que tienen sentido para ese dato: ofrecerle `| moneda` a
 *   un nombre propio es ofrecer un error.
 * · `soloEn` acota por tipo de plantilla. `cobro.*` sólo existe cuando el
 *   documento es un recibo: el contexto del recibo lo arma `recibo()` y ningún
 *   otro. Ofrecerlo en un pre-contrato sería ofrecer un hueco garantizado.
 */

export interface VariableDelCatalogo {
  ruta: string;
  etiqueta: string;
  grupo: string;
  ejemplo: string;
  formatos: string[];
  /** Ausente = sirve en todos los tipos de plantilla. */
  soloEn?: string[];
}

/** Los tipos de plantilla en los que existe el contexto del cobro. */
const SOLO_RECIBO = ['recibo'];

export const CATALOGO_VARIABLES: VariableDelCatalogo[] = [
  // ── La inmobiliaria ────────────────────────────────────────────────────────
  { ruta: 'inmobiliaria.nombre', etiqueta: 'Nombre de la inmobiliaria', grupo: 'Inmobiliaria', ejemplo: 'Inmobiliaria de Ejemplo', formatos: ['mayusculas'] },
  { ruta: 'inmobiliaria.cuit', etiqueta: 'CUIT de la inmobiliaria', grupo: 'Inmobiliaria', ejemplo: '30-71234567-9', formatos: [] },

  // ── La propiedad ───────────────────────────────────────────────────────────
  { ruta: 'propiedad.codigo', etiqueta: 'Código de la propiedad', grupo: 'Propiedad', ejemplo: 'PROP-0001', formatos: [] },
  { ruta: 'propiedad.direccion', etiqueta: 'Dirección completa', grupo: 'Propiedad', ejemplo: 'Arístides Villanueva 345, piso 3 depto B, Ciudad, Mendoza', formatos: ['mayusculas'] },
  { ruta: 'propiedad.localidad', etiqueta: 'Localidad', grupo: 'Propiedad', ejemplo: 'Ciudad', formatos: [] },
  { ruta: 'propiedad.tipo', etiqueta: 'Tipo de propiedad', grupo: 'Propiedad', ejemplo: 'departamento', formatos: [] },

  // ── El contrato ────────────────────────────────────────────────────────────
  { ruta: 'contrato.inicio', etiqueta: 'Fecha de inicio', grupo: 'Contrato', ejemplo: '01/01/2026', formatos: ['fecha', 'fecha_larga'] },
  { ruta: 'contrato.fin', etiqueta: 'Fecha de fin', grupo: 'Contrato', ejemplo: '31/12/2028', formatos: ['fecha', 'fecha_larga'] },
  { ruta: 'contrato.diaVencimiento', etiqueta: 'Día de vencimiento de la cuota', grupo: 'Contrato', ejemplo: '10', formatos: [] },
  { ruta: 'contrato.monto', etiqueta: 'Precio mensual pactado', grupo: 'Contrato', ejemplo: 'ARS 485.000,00', formatos: ['moneda', 'numero', 'letras'] },
  {
    ruta: 'contrato.montoVigente',
    etiqueta: 'Precio mensual vigente hoy',
    grupo: 'Contrato',
    // La distinción importa: en un aviso de aumento va el vigente; en el
    // contrato que se firma va el pactado. Confundirlos imprime en el contrato
    // un alquiler que todavía no rige.
    ejemplo: 'ARS 514.682,00 (el pactado, más los ajustes ya vigentes)',
    formatos: ['moneda', 'numero', 'letras'],
  },
  { ruta: 'contrato.deposito', etiqueta: 'Depósito en garantía', grupo: 'Contrato', ejemplo: 'ARS 485.000,00', formatos: ['moneda', 'numero', 'letras'] },
  { ruta: 'contrato.honorariosPct', etiqueta: 'Honorarios (%)', grupo: 'Contrato', ejemplo: '8', formatos: ['numero'] },
  { ruta: 'contrato.punitorioDiario', etiqueta: 'Punitorio diario (%)', grupo: 'Contrato', ejemplo: '0,1', formatos: ['numero'] },
  { ruta: 'contrato.indice', etiqueta: 'Índice de actualización', grupo: 'Contrato', ejemplo: 'IPC (INDEC)', formatos: [] },
  { ruta: 'contrato.periodicidad', etiqueta: 'Cada cuántos meses se actualiza', grupo: 'Contrato', ejemplo: '3', formatos: ['numero'] },

  // ── Las partes ─────────────────────────────────────────────────────────────
  { ruta: 'locador.nombre', etiqueta: 'Propietario — nombre', grupo: 'Propietario', ejemplo: 'Marta Silva', formatos: ['mayusculas'] },
  { ruta: 'locador.documento', etiqueta: 'Propietario — documento', grupo: 'Propietario', ejemplo: '18456789', formatos: [] },
  { ruta: 'locador.tipoDocumento', etiqueta: 'Propietario — tipo de documento', grupo: 'Propietario', ejemplo: 'DNI', formatos: [] },
  { ruta: 'locador.domicilio', etiqueta: 'Propietario — domicilio', grupo: 'Propietario', ejemplo: 'San Martín 100', formatos: [] },

  { ruta: 'locatario.nombre', etiqueta: 'Inquilino — nombre', grupo: 'Inquilino', ejemplo: 'Camila Rossi', formatos: ['mayusculas'] },
  { ruta: 'locatario.documento', etiqueta: 'Inquilino — documento', grupo: 'Inquilino', ejemplo: '35222111', formatos: [] },
  { ruta: 'locatario.tipoDocumento', etiqueta: 'Inquilino — tipo de documento', grupo: 'Inquilino', ejemplo: 'DNI', formatos: [] },
  { ruta: 'locatario.domicilio', etiqueta: 'Inquilino — domicilio', grupo: 'Inquilino', ejemplo: 'Belgrano 250', formatos: [] },

  // ── Fecha del documento ────────────────────────────────────────────────────
  { ruta: 'hoy', etiqueta: 'Fecha de hoy', grupo: 'General', ejemplo: '9 de agosto de 2026', formatos: ['fecha', 'fecha_larga'] },
  { ruta: 'moneda', etiqueta: 'Moneda del contrato', grupo: 'General', ejemplo: 'ARS', formatos: [] },

  // ── El cobro: SÓLO en el recibo ────────────────────────────────────────────
  { ruta: 'cobro.monto', etiqueta: 'Monto realmente cobrado', grupo: 'Cobro', ejemplo: 'ARS 485.000,00', formatos: ['moneda', 'numero', 'letras'], soloEn: SOLO_RECIBO },
  { ruta: 'cobro.moneda', etiqueta: 'Moneda del cobro', grupo: 'Cobro', ejemplo: 'ARS', formatos: [], soloEn: SOLO_RECIBO },
  { ruta: 'cobro.fecha', etiqueta: 'Fecha del cobro', grupo: 'Cobro', ejemplo: '05/03/2026', formatos: ['fecha', 'fecha_larga'], soloEn: SOLO_RECIBO },
  { ruta: 'cobro.medio', etiqueta: 'Forma de pago', grupo: 'Cobro', ejemplo: 'transferencia bancaria', formatos: [], soloEn: SOLO_RECIBO },
  { ruta: 'cobro.comprobante', etiqueta: 'Número de comprobante', grupo: 'Cobro', ejemplo: '0001-00004521', formatos: [], soloEn: SOLO_RECIBO },
  { ruta: 'cobro.concepto', etiqueta: 'Concepto', grupo: 'Cobro', ejemplo: 'alquiler', formatos: [], soloEn: SOLO_RECIBO },
  { ruta: 'cobro.periodo', etiqueta: 'Período (fecha)', grupo: 'Cobro', ejemplo: '01/03/2026', formatos: ['fecha'], soloEn: SOLO_RECIBO },
  { ruta: 'cobro.periodoTexto', etiqueta: 'Período escrito', grupo: 'Cobro', ejemplo: 'marzo de 2026', formatos: [], soloEn: SOLO_RECIBO },
  { ruta: 'cobro.venceEl', etiqueta: 'Vencimiento de la cuota', grupo: 'Cobro', ejemplo: '10/03/2026', formatos: ['fecha', 'fecha_larga'], soloEn: SOLO_RECIBO },
  { ruta: 'cobro.totalCuota', etiqueta: 'Total de la cuota', grupo: 'Cobro', ejemplo: 'ARS 485.000,00', formatos: ['moneda', 'numero'], soloEn: SOLO_RECIBO },
  { ruta: 'cobro.saldo', etiqueta: 'Saldo que queda', grupo: 'Cobro', ejemplo: 'ARS 0,00', formatos: ['moneda', 'numero'], soloEn: SOLO_RECIBO },
  { ruta: 'cobro.registradoPor', etiqueta: 'Quién registró el cobro', grupo: 'Cobro', ejemplo: 'Sofía Aguirre', formatos: [], soloEn: SOLO_RECIBO },
];

/**
 * Los bloques de estructura que ofrece la barra del editor.
 *
 * Van con las listas que EXISTEN en el contexto, no con un campo libre: un
 * `{% para x en inquilinos %}` escrito de memoria —el contexto los llama
 * `locatarios`— no falla, simplemente no imprime nada, y eso no se nota hasta
 * que el contrato sale sin las partes.
 */
export interface BloqueDelCatalogo {
  clase: 'si' | 'para';
  expr: string;
  /** Sólo en `para`: el nombre con el que se lee cada elemento adentro. */
  item?: string;
  etiqueta: string;
  ayuda: string;
  /** Las variables que existen adentro del bloque, con su ruta ya prefijada. */
  adentro?: VariableDelCatalogo[];
  soloEn?: string[];
}

const CAMPOS_DE_PERSONA = (item: string, quien: string): VariableDelCatalogo[] => [
  { ruta: `${item}.nombre`, etiqueta: `${quien} — nombre`, grupo: quien, ejemplo: 'Jorge Ferreyra', formatos: ['mayusculas'] },
  { ruta: `${item}.documento`, etiqueta: `${quien} — documento`, grupo: quien, ejemplo: '22987654', formatos: [] },
  { ruta: `${item}.domicilio`, etiqueta: `${quien} — domicilio`, grupo: quien, ejemplo: 'Rivadavia 80', formatos: [] },
];

export const CATALOGO_BLOQUES: BloqueDelCatalogo[] = [
  {
    clase: 'si', expr: 'contrato.deposito', etiqueta: 'Si hay depósito',
    ayuda: 'Lo de adentro sale sólo cuando el contrato tiene depósito cargado.',
  },
  {
    clase: 'si', expr: 'garantes', etiqueta: 'Si hay garantes',
    ayuda: 'Lo de adentro sale sólo cuando el contrato tiene al menos un garante.',
  },
  {
    clase: 'para', expr: 'garantes', item: 'g', etiqueta: 'Por cada garante',
    ayuda: 'Lo de adentro se repite una vez por garante.',
    adentro: CAMPOS_DE_PERSONA('g', 'Garante'),
  },
  {
    clase: 'para', expr: 'locadores', item: 'l', etiqueta: 'Por cada propietario',
    ayuda: 'Se repite una vez por titular. Sirve cuando la propiedad tiene varios dueños.',
    adentro: [
      ...CAMPOS_DE_PERSONA('l', 'Propietario'),
      { ruta: 'l.porcentaje', etiqueta: 'Propietario — % de titularidad', grupo: 'Propietario', ejemplo: '100', formatos: ['numero'] },
    ],
  },
  {
    clase: 'para', expr: 'locatarios', item: 'i', etiqueta: 'Por cada inquilino',
    ayuda: 'Se repite una vez por inquilino. Sirve cuando firman dos o más.',
    adentro: CAMPOS_DE_PERSONA('i', 'Inquilino'),
  },
  {
    clase: 'si', expr: 'cobro.esParcial', etiqueta: 'Si el pago fue parcial',
    ayuda:
      'Lo de adentro sale sólo cuando quedó saldo. El motor no tiene negación: ' +
      'la bandera va en positivo a propósito.',
    soloEn: SOLO_RECIBO,
  },
  {
    clase: 'si', expr: 'cobro.comprobante', etiqueta: 'Si hay comprobante',
    ayuda: 'Lo de adentro sale sólo cuando el cobro tiene número de comprobante.',
    soloEn: SOLO_RECIBO,
  },
];

/** El catálogo acotado a un tipo de plantilla. Sin tipo, va entero. */
export function catalogoPara(tipo?: string): {
  variables: VariableDelCatalogo[];
  bloques: BloqueDelCatalogo[];
  formatos: Array<{ nombre: string; que: string }>;
} {
  const sirve = (x: { soloEn?: string[] }) => !x.soloEn || !tipo || x.soloEn.includes(tipo);
  return {
    variables: CATALOGO_VARIABLES.filter(sirve),
    bloques: CATALOGO_BLOQUES.filter(sirve),
    formatos: FORMATOS_EXPLICADOS,
  };
}

/** Qué hace cada formato, en castellano. La pantalla lo muestra al elegirlo. */
export const FORMATOS_EXPLICADOS = [
  { nombre: 'moneda', que: 'ARS 485.000,00 — con la moneda del contrato y dos decimales' },
  { nombre: 'numero', que: '485.000 — con separador de miles' },
  { nombre: 'fecha', que: '01/01/2026' },
  { nombre: 'fecha_larga', que: '1 de enero de 2026' },
  { nombre: 'mayusculas', que: 'MARTA SILVA' },
  { nombre: 'letras', que: 'cuatrocientos ochenta y cinco mil — el monto escrito' },
];
