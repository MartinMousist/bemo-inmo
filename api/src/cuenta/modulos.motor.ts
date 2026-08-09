/**
 * Qué ve cada clase de cuenta. PURO: entran el tipo y sus excepciones, sale la
 * lista de módulos visibles.
 *
 * ── Por qué existe ──
 *
 * No toda la gente que administra alquileres es una inmobiliaria. Quien
 * gestiona veinte departamentos no vende, no reparte comisiones y no tiene
 * embudo de captación: para esa persona, Ventas, Comisiones, Reservas, Leads y
 * Publicaciones son cinco secciones que no va a abrir nunca, y su presencia
 * dice «esto no es para vos» antes de que llegue a probar nada.
 *
 * ── Las tres decisiones ──
 *
 * **Se guardan las EXCEPCIONES, no la lista.** Lo que trae cada tipo se calcula
 * acá, en código. Si se guardara la lista completa por cuenta, el día que el
 * producto sume un módulo, ninguna cuenta existente lo vería —su lista se
 * escribió antes de que existiera— y habría que migrar filas para algo que
 * debería ser gratis.
 *
 * **Apagar es esconder, no borrar.** Un módulo apagado saca la entrada del menú
 * y bloquea su ruta; no toca un solo dato. Un gestor que empieza a vender
 * prende Ventas y ahí están sus operaciones, si alguna vez cargó alguna. La
 * alternativa —borrar o bloquear en la base— convierte una preferencia en una
 * jaula.
 *
 * **El plan manda por encima de todo.** `plan.modulos` ya limitaba desde la
 * migración 011 y eso no cambia: el tipo de cuenta puede APAGAR algo que el
 * plan permite, nunca prender algo que el plan no incluye. Si fuera al revés,
 * el interruptor de una pantalla saltearía la facturación.
 */

export type TipoCuenta = 'inmobiliaria' | 'gestor';

export const TIPOS: TipoCuenta[] = ['inmobiliaria', 'gestor'];

/**
 * Los módulos que se pueden prender y apagar.
 *
 * El NÚCLEO no está acá y no se apaga: cartera, contratos, cobranza,
 * liquidaciones, gastos, personas, equipo y ajustes son el sistema. Una cuenta
 * sin contratos no es una cuenta con menos módulos, es otra aplicación.
 */
export interface Modulo {
  clave: string;
  nombre: string;
  /** Qué se pierde al apagarlo, en una línea que se lee en la pantalla. */
  detalle: string;
  /** Las rutas del front que deja de haber. La primera es la del menú. */
  rutas: string[];
}

export const MODULOS: Modulo[] = [
  {
    clave: 'leads',
    nombre: 'Leads',
    detalle: 'El embudo de consultas: quién preguntó por qué propiedad y en qué anda.',
    rutas: ['/leads'],
  },
  {
    clave: 'ventas',
    nombre: 'Ventas',
    detalle: 'Reserva, boleto y escritura, con su reparto de honorarios.',
    rutas: ['/ventas'],
  },
  {
    clave: 'comisiones',
    nombre: 'Comisiones',
    detalle: 'Los porcentajes de la casa y de cada agente, y cómo se reparte cada operación.',
    rutas: ['/comisiones'],
  },
  {
    clave: 'publicaciones',
    nombre: 'Publicaciones',
    detalle: 'El aviso listo para pegar en los portales y el feed XML de la cartera.',
    rutas: ['/publicaciones'],
  },
  {
    clave: 'reservas',
    nombre: 'Reservas',
    detalle: 'Las señas tomadas sobre una operación y su vencimiento.',
    rutas: ['/reservas'],
  },
];

const CLAVES = new Set(MODULOS.map((m) => m.clave));

/**
 * Lo que trae cada tipo de fábrica.
 *
 * Un gestor arranca sin los cinco. No es que «no pueda»: es que su trabajo es
 * cobrar el 1 de cada mes, liquidarle al propietario y que no se le venza una
 * garantía. Todo eso es núcleo y lo tiene entero.
 */
export const MODULOS_POR_TIPO: Record<TipoCuenta, string[]> = {
  inmobiliaria: MODULOS.map((m) => m.clave),
  gestor: [],
};

export const ETIQUETA_TIPO: Record<TipoCuenta, string> = {
  inmobiliaria: 'Inmobiliaria',
  gestor: 'Gestión de alquileres',
};

export const DESCRIPCION_TIPO: Record<TipoCuenta, string> = {
  inmobiliaria:
    'Opera venta y alquiler, con captación, publicación en portales y reparto de comisiones.',
  gestor:
    'Administra alquileres —propios o de terceros— y no trabaja con ventas ni comisiones.',
};

export interface EstadoModulo extends Modulo {
  activo: boolean;
  /** Por qué está como está: lo que la pantalla explica sin que nadie pregunte. */
  motivo: 'tipo' | 'prendido' | 'apagado' | 'fuera-del-plan';
}

/**
 * El estado de cada módulo para una cuenta.
 *
 * El orden de resolución importa y es el que está escrito arriba: **el plan
 * primero**. Un módulo fuera del plan aparece apagado y con su motivo, sin
 * interruptor: la pantalla ofrece cambiar de plan, no prenderlo.
 */
export function estadoDeModulos(
  tipo: TipoCuenta,
  on: string[] = [],
  off: string[] = [],
  delPlan?: string[] | null,
): EstadoModulo[] {
  const base = new Set(MODULOS_POR_TIPO[tipo] ?? []);
  const prendidos = new Set(on.filter((c) => CLAVES.has(c)));
  const apagados = new Set(off.filter((c) => CLAVES.has(c)));

  return MODULOS.map((m) => {
    // `delPlan` sin definir = no hay límite de plan que aplicar. Es distinto de
    // un array vacío, que sería un plan que no incluye nada.
    //
    // La comparación va por `claveDePlan`: el menú dice `leads` y el plan dice
    // `oportunidades`. Sin traducir, el módulo que TODOS los planes incluyen
    // aparecería fuera del plan en todas las cuentas.
    if (delPlan && !esNucleoDePlan(m.clave) && !delPlan.includes(claveDePlan(m.clave))) {
      return { ...m, activo: false, motivo: 'fuera-del-plan' as const };
    }
    if (apagados.has(m.clave)) return { ...m, activo: false, motivo: 'apagado' as const };
    if (prendidos.has(m.clave)) return { ...m, activo: true, motivo: 'prendido' as const };
    return {
      ...m,
      activo: base.has(m.clave),
      motivo: 'tipo' as const,
    };
  });
}

/** Sólo las claves activas. Es lo que el front usa para armar el menú. */
export function modulosActivos(
  tipo: TipoCuenta,
  on: string[] = [],
  off: string[] = [],
  delPlan?: string[] | null,
): string[] {
  return estadoDeModulos(tipo, on, off, delPlan).filter((m) => m.activo).map((m) => m.clave);
}

/**
 * `plan.modulos` y estas claves no son el mismo vocabulario y no hay que
 * forzarlos: el plan habla de `oportunidades` y el menú de `leads`, y hay
 * módulos de navegación —`ventas`, `publicaciones`, `reservas`— que ningún plan
 * nombra porque siempre estuvieron incluidos.
 *
 * Esta función dice cuáles NO se comparan contra el plan. Traducir sería peor:
 * un mapa de sinónimos que hay que acordarse de actualizar en dos lados.
 */
function esNucleoDePlan(clave: string): boolean {
  return clave === 'ventas' || clave === 'publicaciones' || clave === 'reservas';
}

/** `leads` en el menú es `oportunidades` en el plan. La única traducción real. */
export function claveDePlan(clave: string): string {
  return clave === 'leads' ? 'oportunidades' : clave;
}
