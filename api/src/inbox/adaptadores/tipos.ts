/**
 * El contrato que cumple cada canal.
 *
 * ── Por qué una interfaz y no un `switch` por canal ──
 *
 * Porque el plan es Twilio ahora y la API oficial de Meta después, para el
 * MISMO canal de WhatsApp. Con un `switch (canal)` esa migración toca cada
 * lugar que manda un mensaje; con esto es cambiar `proveedor` en una fila.
 *
 * Por eso la tabla guarda `canal` y `proveedor` separados: el canal es lo que
 * ve el cliente, el proveedor es por dónde sale.
 */

export interface Adjunto {
  tipo: 'imagen' | 'audio' | 'video' | 'documento' | 'ubicacion' | 'otro';
  url?: string;
  /** El id del archivo en el proveedor, cuando la descarga es aparte. */
  idExterno?: string;
  nombre?: string;
  mime?: string;
}

/** Un mensaje que entra, ya traducido desde el formato del proveedor. */
export interface MensajeEntrante {
  /** El id del proveedor. Es la clave de idempotencia del webhook. */
  idExterno: string;
  /** Quién escribe, en las coordenadas del canal. */
  contactoExterno: string;
  contactoNombre: string | null;
  cuerpo: string;
  adjuntos: Adjunto[];
  recibidoEl: Date;
}

/** Lo que el adaptador necesita saber de la cuenta para trabajar. */
export interface CuentaCanal {
  id: string;
  tenantId: string;
  /** `null` = canal de la inmobiliaria. Con valor, es el número de esa persona. */
  usuarioId?: string | null;
  canal: string;
  proveedor: string;
  identificador: string;
  config: Record<string, unknown>;
  /** Descifrado en el momento. Nunca se loguea ni sale por la API. */
  secreto: string | null;
}

export interface ResultadoEnvio {
  idExterno: string | null;
  /** `false` cuando el canal no puede enviar todavía: queda encolado. */
  enviado: boolean;
  detalle: string;
}

export interface Adaptador {
  readonly proveedor: string;
  /** Los canales que este proveedor sabe manejar. */
  readonly canales: readonly string[];

  /**
   * ¿Puede enviar de verdad hoy, con esta cuenta?
   *
   * Es la misma honestidad que ya cumple `GET /avisos/canales`: si devuelve
   * `false`, la pantalla lo dice y el cuadro de respuesta avisa que queda en
   * cola. Nunca se simula que un mensaje salió.
   */
  disponible(cuenta: CuentaCanal): { ok: boolean; detalle: string };

  /**
   * ¿Este webhook viene realmente del proveedor?
   *
   * Devuelve `false` ante cualquier duda. El endpoint es PÚBLICO —el proveedor
   * no tiene cómo autenticarse contra nosotros— así que sin esto cualquiera que
   * adivine la URL puede inyectar mensajes en la bandeja de una inmobiliaria.
   */
  verificarFirma(cuenta: CuentaCanal, ctx: ContextoWebhook): boolean;

  /** Traduce el cuerpo del webhook a mensajes nuestros. */
  parsear(cuerpo: unknown): MensajeEntrante[];

  enviar(cuenta: CuentaCanal, destino: string, texto: string): Promise<ResultadoEnvio>;

  /**
   * Deja la cuenta lista contra el proveedor: valida la credencial y registra
   * el webhook si el canal lo necesita.
   *
   * Opcional porque no todos lo tienen: en Twilio y Meta el webhook se carga a
   * mano en su panel, no por API.
   */
  conectar?(cuenta: CuentaCanal, urlWebhook: string | null): Promise<ResultadoConexion>;

  /**
   * Trae lo que haya pendiente, SIN webhook.
   *
   * Sólo Telegram lo ofrece (`getUpdates`), y es lo que permite probar el
   * circuito en una laptop sin exponer nada a internet. En producción se usa el
   * webhook; esto es para desarrollo.
   */
  sondear?(cuenta: CuentaCanal, offset: number): Promise<ResultadoSondeo>;
}

export interface ResultadoConexion {
  ok: boolean;
  detalle: string;
  /** El nombre con el que el proveedor conoce a esta cuenta, si lo devuelve. */
  identidad?: string;
}

export interface ResultadoSondeo {
  mensajes: MensajeEntrante[];
  /** El offset para la próxima vuelta. Se guarda para no repetir. */
  siguienteOffset: number;
  error?: string;
}

export interface ContextoWebhook {
  /** La URL completa a la que pegó el proveedor. Twilio la firma. */
  url: string;
  headers: Record<string, string | undefined>;
  cuerpo: unknown;
  /** El cuerpo crudo, para las firmas que se calculan sobre bytes. */
  crudo?: string;
}
