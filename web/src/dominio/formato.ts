/**
 * Formateo. En este producto no es cosmética: es una regla de DESIGN.md.
 *
 * - Ningún monto sin su moneda. ARS y USD conviven en la misma tabla; un "$"
 *   ambiguo acá es un error de plata, no de diseño.
 * - Fechas en dd/mm/aaaa. Nunca formato US.
 * - Separador de miles "." y decimal "," (es-AR).
 */

const MONEDA_FMT = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const ENTERO_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

export function money(monto: number | null | undefined, moneda: string): string {
  if (monto === null || monto === undefined) return '—';
  return `${moneda} ${MONEDA_FMT.format(monto)}`;
}

/** Para listados donde los centavos son ruido. La moneda va igual. */
export function moneyCorto(monto: number | null | undefined, moneda: string): string {
  if (monto === null || monto === undefined) return '—';
  return `${moneda} ${ENTERO_FMT.format(monto)}`;
}

export function numero(n: number | null | undefined, sufijo = ''): string {
  if (n === null || n === undefined) return '—';
  return `${ENTERO_FMT.format(n)}${sufijo}`;
}

/**
 * `plural(1, 'contrato', 'contratos')` → «1 contrato».
 *
 * Existe para terminar con las **85 apariciones** de `(s)` y `(es)` que había
 * repartidas por el producto: «1 contrato(s)», «2 propiedad(es) sin ubicación»,
 * «liquidación(es) armada(s)». En un producto cuya ancla es *exacto*, es la
 * marca más visible de que esa línea no la escribió nadie — y en castellano el
 * paréntesis además no siempre funciona: el plural de «liquidación» no es
 * «liquidación(es)» sino «liquidaciones», sin tilde.
 *
 * Por eso pide las dos formas completas en vez de intentar derivar la segunda:
 * las reglas de acentuación no entran en un `+ 's'`.
 *
 * `incluirNumero: false` devuelve sólo el sustantivo, para cuando el número ya
 * está en pantalla como cifra grande y repetirlo sería ruido.
 */
export function plural(
  n: number | null | undefined,
  singular: string,
  plural: string,
  incluirNumero = true,
): string {
  const cantidad = n ?? 0;
  const palabra = Math.abs(cantidad) === 1 ? singular : plural;
  return incluirNumero ? `${ENTERO_FMT.format(cantidad)} ${palabra}` : palabra;
}

/**
 * Un `YYYY-MM-DD` es una fecha de calendario, NO un instante.
 *
 * `new Date('2026-01-01')` lo interpreta como medianoche UTC; al mostrarlo en
 * Argentina (UTC-3) se corre al 31/12/2025. Un contrato que empieza el 1 pasa a
 * empezar el 31 del mes anterior, y un aumento que rige desde abril aparece en
 * marzo. Por eso las fechas puras se parten a mano y nunca pasan por Date.
 *
 * Los `timestamptz` (con hora) sí son instantes y ahí la zona corresponde: eso
 * lo maneja `fechaHora`.
 */
function partesDeFecha(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function fecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  const p = partesDeFecha(iso);
  if (!p) return '—';
  const [a, m, d] = p;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/** "nov/25" — para períodos de índices y liquidaciones. */
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
               'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function periodo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const p = partesDeFecha(iso);
  if (!p) return '—';
  const [a, m] = p;
  return `${MESES[m - 1]}/${String(a).slice(2)}`;
}

/**
 * Días hasta una fecha, y el color semántico que le corresponde.
 * >30d neutro · 30-8d warning · ≤7d danger · vencido danger sólido.
 */
export function proximidad(iso: string | null | undefined): {
  dias: number | null;
  tono: 'neutro' | 'warn' | 'err' | 'vencido';
  texto: string;
} {
  if (!iso) return { dias: null, tono: 'neutro', texto: '—' };
  const p = partesDeFecha(iso);
  if (!p) return { dias: null, tono: 'neutro', texto: '—' };
  // Se construye en hora LOCAL, no UTC, para comparar contra hoy sin corrimiento.
  const d = new Date(p[0], p[1] - 1, p[2]);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const dias = Math.round((d.getTime() - hoy.getTime()) / 86_400_000);

  if (dias < 0) return { dias, tono: 'vencido', texto: `Vencido hace ${-dias} d` };
  if (dias === 0) return { dias, tono: 'err', texto: 'Vence hoy' };
  if (dias <= 7) return { dias, tono: 'err', texto: `En ${dias} d` };
  if (dias <= 30) return { dias, tono: 'warn', texto: `En ${dias} d` };
  return { dias, tono: 'neutro', texto: `En ${dias} d` };
}

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

export const ETIQUETA_OPERACION: Record<string, string> = {
  venta: 'Venta',
  alquiler: 'Alquiler',
  alquiler_temporario: 'Temporario',
};

/**
 * La SITUACIÓN de una operación, en las palabras del rubro.
 *
 * ── El bug que esta función existe para no repetir ──────────────────────────
 *
 * El estado de una operación se llama `cerrada` en la base, y hasta acá las
 * pantallas lo mostraban como «Cerrada». Para una VENTA está bien; para un
 * ALQUILER es al revés de lo que pasó: una unidad alquilada tiene su operación
 * en `cerrada` justamente porque está ocupada y generando plata. Por leer esa
 * palabra al revés, la cartera de alquiler excluía las cerradas y mostraba
 * **3 de 13** propiedades — las tres que NO estaban alquiladas.
 *
 * ── Por qué el tipo de operación es OBLIGATORIO y no tiene default ──────────
 *
 * Porque es lo que hace que `vue-tsc --noEmit` haga el relevamiento. La
 * etiqueta vivía en TRES lugares —este archivo, un `ESTADO` local en la cartera
 * y un `TONO_ESTADO` al lado— y por eso derivó. Con el parámetro obligatorio,
 * un call site que quede sin migrar no compila; con un default, compilaría y
 * seguiría diciendo «Cerrada» donde debía decir «Alquilada», en silencio. Es el
 * mismo argumento por el que el % del agente usa `@ValidateIf` y no
 * `@IsOptional()`.
 *
 * Un estado desconocido vuelve **crudo**, que es lo que ya hacía el `?? o.estado`
 * repetido en cada pantalla: si mañana la base tiene un estado nuevo, se ve el
 * valor y no un «undefined» ni un guión que esconde el problema.
 */
export function etiquetaSituacion(estado: string, tipoOperacion: string): string {
  if (estado === 'cerrada') {
    return tipoOperacion === 'venta' ? 'Vendida' : 'Alquilada';
  }
  return SITUACIONES_COMUNES[estado] ?? estado;
}

/** Los estados cuya palabra no depende del tipo de operación. */
const SITUACIONES_COMUNES: Record<string, string> = {
  borrador: 'Borrador',
  disponible: 'Disponible',
  reservada: 'Reservada',
  suspendida: 'Suspendida',
};

/**
 * El color del chip de situación.
 *
 * Estaba triplicado igual que la etiqueta, y los tres NO coincidían: `cerrada`
 * era `err` (rojo) en Propiedades y en la ficha, y `neutro` en la cartera. O sea
 * que la misma operación se pintaba roja en una pantalla y neutra en otra.
 *
 * Manda el neutro, y no por consenso: **una venta cerrada es el mejor resultado
 * posible**. Pintarla de rojo es el mismo malentendido que la palabra
 * «Cerrada», dibujado en vez de escrito. El rojo queda para `suspendida`, que sí
 * es una operación frenada.
 */
export function tonoSituacion(estado: string): 'neutro' | 'ok' | 'warn' | 'err' {
  if (estado === 'disponible') return 'ok';
  if (estado === 'reservada') return 'warn';
  if (estado === 'suspendida') return 'err';
  // `borrador`, `cerrada` y cualquier estado nuevo: neutro.
  return 'neutro';
}

/**
 * Las opciones del filtro «Situación», ya con la palabra que corresponde al
 * listado que se está mirando.
 *
 * Sin esto el desplegable de la cartera de alquiler ofrecería «Cerrada», que es
 * la palabra que causó el bug — y el usuario tendría que adivinar que ésa es la
 * que filtra las unidades alquiladas.
 */
export function situacionesDe(
  tipoOperacion: string,
): Array<{ valor: string; etiqueta: string }> {
  return ['borrador', 'disponible', 'reservada', 'cerrada', 'suspendida'].map((valor) => ({
    valor,
    etiqueta: etiquetaSituacion(valor, tipoOperacion),
  }));
}

/** Los valores crudos, para validar un filtro guardado (regla 2 de `filtros.ts`). */
export const ESTADOS_OPERACION = [
  'borrador', 'disponible', 'reservada', 'cerrada', 'suspendida',
] as const;

export const ETIQUETA_ESTADO_OPORTUNIDAD: Record<string, string> = {
  nueva: 'Nueva',
  contactada: 'Contactada',
  calificada: 'Calificada',
  visita: 'Visita',
  negociacion: 'Negociación',
  ganada: 'Ganada',
  perdida: 'Perdida',
};

export const ETIQUETA_ORIGEN: Record<string, string> = {
  portal: 'Portal',
  web: 'Web',
  whatsapp: 'WhatsApp',
  telefono: 'Teléfono',
  referido: 'Referido',
  cartel: 'Cartel',
  redes: 'Redes',
  otro: 'Otro',
};
