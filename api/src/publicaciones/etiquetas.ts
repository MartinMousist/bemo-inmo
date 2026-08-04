/** Etiquetas de dominio compartidas entre el generador de aviso y la API. */
export const ETIQUETA_TIPO: Record<string, string> = {
  departamento: 'Departamento',
  casa: 'Casa',
  ph: 'PH',
  local: 'Local',
  oficina: 'Oficina',
  galpon: 'Galpón',
  terreno: 'Terreno',
  cochera: 'Cochera',
  campo: 'Campo',
};

export const PORTALES = [
  'zonaprop', 'argenprop', 'mercadolibre', 'properati', 'inmoup', 'web_propia', 'otro',
] as const;

/**
 * Estado de la integración con cada portal. `false` = no hay convenio todavía y
 * el flujo es copiar y pegar. Cuando se firme uno, se cambia acá y la UI se
 * actualiza sola — sin prometer antes de tiempo lo que todavía no existe.
 */
export const INTEGRACION_ACTIVA: Record<string, boolean> = {
  zonaprop: false,
  argenprop: false,
  mercadolibre: false,
  properati: false,
  inmoup: false,
  web_propia: false,
  otro: false,
};
