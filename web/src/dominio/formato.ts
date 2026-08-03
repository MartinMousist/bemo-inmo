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

export const ETIQUETA_ESTADO_OP: Record<string, string> = {
  borrador: 'Borrador',
  disponible: 'Disponible',
  reservada: 'Reservada',
  cerrada: 'Cerrada',
  suspendida: 'Suspendida',
};

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
