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
  /**
   * Qué tan real es hoy.
   *
   * `listo` funciona. `parcial` funciona una parte y `nota` dice cuál falta.
   * `pronto` no está construido.
   *
   * ── Por qué vive acá y no en la página de precios ──
   *
   * Estaba en tres lados: la landing lo tenía escrito a mano, la pantalla de
   * «Tu plan» tenía su propio diccionario, y ninguno de los dos sabía lo que
   * decía el otro. Ya habían divergido —la landing seguía ofreciendo «Inicial,
   * Medio y Pro», que dejaron de existir en la migración 046—.
   *
   * Y es la clase de dato que NO puede divergir: un tilde en una página de
   * precios es una promesa. El playbook lo dice con todas las letras, y este
   * repo ya lo pagó una vez con «Comisiones por punta», que salía con tilde en
   * una sección y como «En desarrollo» ocho más arriba de la MISMA página.
   */
  estado?: 'listo' | 'parcial' | 'pronto';
  /** Qué falta, cuando `estado` no es `listo`. Se muestra tal cual. */
  nota?: string;
  /**
   * Lo gobierna el PLAN y no el usuario: aparece según el plan, sin
   * interruptor.
   *
   * La diferencia con los demás no es de importancia sino de quién decide.
   * «Leads» se apaga porque a un gestor de alquileres no le sirve —es una
   * preferencia—. «Liquidaciones» no se apaga: si el plan la incluye, está, y
   * si no la incluye, lo que corresponde ofrecer es cambiar de plan, no un
   * interruptor que no va a arreglar nada.
   */
  fijo?: boolean;
}

export const MODULOS: Modulo[] = [
  {
    clave: 'leads',
    nombre: 'Leads',
    detalle: 'El embudo de consultas: quién preguntó por qué propiedad y en qué anda.',
    rutas: ['/leads'],
    estado: 'listo',
  },
  {
    clave: 'ventas',
    nombre: 'Ventas',
    detalle: 'Reserva, boleto y escritura, con su reparto de honorarios.',
    rutas: ['/ventas'],
    estado: 'listo',
  },
  {
    clave: 'comisiones',
    nombre: 'Comisiones',
    detalle: 'Los porcentajes de la casa y de cada agente, y cómo se reparte cada operación.',
    rutas: ['/comisiones'],
    estado: 'listo',
  },
  {
    clave: 'publicaciones',
    nombre: 'Publicaciones',
    detalle: 'El aviso listo para pegar en los portales y el feed XML de la cartera.',
    rutas: ['/publicaciones'],
    estado: 'parcial',
    nota: 'Publicar directo en cada portal depende de un convenio con cada uno, que no controlamos.',
  },
  {
    clave: 'reservas',
    nombre: 'Reservas',
    detalle: 'Las señas tomadas sobre una operación y su vencimiento.',
    rutas: ['/reservas'],
    estado: 'listo',
  },

  // ── Los que gobierna el plan ───────────────────────────────────────────────
  //
  // Todo esto se construyó entre las etapas 12 y 19 y no figuraba en ningún
  // plan, así que hasta la migración 044 lo tenía cualquiera. No es que se le
  // quite algo a nadie: es que nunca estuvo decidido a quién le tocaba.
  {
    clave: 'liquidaciones',
    nombre: 'Liquidaciones',
    detalle: 'La rendición mensual al propietario, con honorarios, gastos y retenciones.',
    rutas: ['/liquidaciones'],
    estado: 'listo',
    fijo: true,
  },
  {
    clave: 'portal',
    nombre: 'Portales de propietario e inquilino',
    detalle: 'El enlace sin cuenta donde cada uno ve lo suyo y deja de llamar para preguntarlo.',
    rutas: ['/propietarios'],
    estado: 'listo',
    fijo: true,
  },
  {
    clave: 'avisos',
    nombre: 'Avisos de vencimiento',
    detalle: 'La bandeja que se genera sola: qué contrato vence, qué aumento toca, qué garantía se cae.',
    // Vencimientos NO está acá: mirar qué se viene es núcleo y es la razón por
    // la que alguien deja el Excel. Lo que este módulo agrega es que el sistema
    // lo levante solo y lleve la cuenta de lo visto.
    rutas: ['/avisos'],
    estado: 'parcial',
    nota:
      'Los avisos se generan y se ven adentro del sistema. Que salgan solos por WhatsApp o mail necesita un proveedor de correo y la verificación de negocio de Meta.',
    fijo: true,
  },
  {
    clave: 'bandeja',
    nombre: 'Bandeja de mensajes',
    detalle: 'WhatsApp, Telegram, Instagram y mail en un solo lugar, con tus plantillas a mano.',
    rutas: ['/inbox'],
    estado: 'parcial',
    nota:
      'WhatsApp, Telegram e Instagram andan. El correo entra, pero para RESPONDER por mail falta configurar un proveedor de envío.',
    fijo: true,
  },
  {
    // Separado de `bandeja` a propósito: centralizar mensajes es
    // infraestructura y sirve desde el primer día; que algo conteste solo es
    // una decisión, y hay quien no la quiere ni gratis.
    clave: 'bot',
    nombre: 'Respuestas automáticas',
    detalle: 'El bot que contesta, sus palabras de salida y cuándo llama a una persona.',
    rutas: ['/bot'],
    estado: 'listo',
    fijo: true,
  },
  {
    clave: 'red',
    nombre: 'La Red',
    detalle: 'Buscar y ofrecer propiedades entre inmobiliarias, con comisión compartida.',
    rutas: ['/red'],
    estado: 'listo',
    fijo: true,
  },
  {
    clave: 'documentos',
    nombre: 'Documentos y pre-contratos',
    detalle: 'Las plantillas de la casa y el documento generado listo para firmar.',
    rutas: ['/plantillas'],
    estado: 'listo',
    fijo: true,
  },
  {
    clave: 'emprendimientos',
    nombre: 'Emprendimientos en pozo',
    detalle: 'Unidades por planilla, planes de pago y calculadoras de cuota y de inversión.',
    rutas: ['/emprendimientos'],
    estado: 'listo',
    fijo: true,
  },
  {
    clave: 'conciliacion',
    nombre: 'Conciliación bancaria',
    detalle: 'El extracto del banco cruzado contra los cobros, sin marcar uno por uno.',
    rutas: ['/conciliacion'],
    estado: 'listo',
    fijo: true,
  },
  // ── Los que el plan gobierna pero no tienen entrada propia en el menú ──
  //
  // `multisucursal` y `api` viven en «Tu cuenta»; `marca_blanca` y `arca`
  // todavía no existen. Están en el catálogo igual porque la página de precios
  // los nombra, y sin entrada acá salían con su clave cruda —«marca_blanca»—
  // y sin poder decir si funcionan.
  {
    clave: 'multisucursal',
    nombre: 'Multi-sucursal',
    detalle: 'Más de una oficina, cada una con su cartera y su equipo.',
    rutas: ['/cuenta'],
    estado: 'listo',
    fijo: true,
  },
  {
    clave: 'api',
    nombre: 'API y webhooks',
    detalle: 'Claves de acceso para conectarlo con tu sitio o con lo que ya usás.',
    rutas: ['/cuenta'],
    estado: 'listo',
    fijo: true,
  },
  {
    clave: 'marca_blanca',
    nombre: 'Marca blanca',
    detalle: 'Tu logo y tus colores en el portal y en lo que ve el cliente.',
    rutas: [],
    estado: 'pronto',
    nota: 'Todavía no está construido. No hay una línea de código: se dice, en vez de ofrecerlo.',
    fijo: true,
  },
  {
    clave: 'arca',
    nombre: 'Facturación ARCA',
    detalle: 'La factura electrónica emitida desde el sistema.',
    rutas: [],
    estado: 'pronto',
    nota: 'Espera la habilitación del certificado en ARCA, que es un trámite y no código.',
    fijo: true,
  },
  {
    clave: 'actas',
    nombre: 'Actas de inicio y cierre',
    detalle: 'El estado de la propiedad con fotos, al entregar y al recibir.',
    rutas: ['/contratos'],
    estado: 'listo',
    fijo: true,
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
    // Sin traducción ni excepciones: desde la migración 044 el plan usa
    // EXACTAMENTE las mismas claves que este catálogo. Antes el plan decía
    // `oportunidades` donde el menú dice `leads`, y `ventas`, `publicaciones` y
    // `reservas` estaban exentos «porque ningún plan los nombra» — cosa que
    // dejó de ser cierta y habría dejado a un plan Base mostrando
    // Publicaciones.
    if (delPlan && !delPlan.includes(m.clave)) {
      return { ...m, activo: false, motivo: 'fuera-del-plan' as const };
    }
    // Los fijos no miran interruptores: si el plan lo incluye, está.
    if (m.fijo) return { ...m, activo: true, motivo: 'tipo' as const };
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

// Acá vivían `esNucleoDePlan()` y `claveDePlan()`, que traducían entre el
// vocabulario del menú y el de los planes y eximían tres módulos de la
// comparación. La migración 044 hizo que los planes usen exactamente estas
// claves, así que las dos funciones dejaron de tener nada que hacer. Un mapa de
// sinónimos que ya no traduce nada es una trampa esperando: el día que alguien
// agregue un módulo, va a preguntarse si tiene que anotarlo ahí.
