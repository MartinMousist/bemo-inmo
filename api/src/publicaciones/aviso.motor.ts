import { ETIQUETA_TIPO } from './etiquetas';

/**
 * Generador de aviso. Puro: entra una propiedad, sale el texto listo.
 *
 * Esto es el **Plan B** del roadmap, y se construyó ANTES que cualquier
 * integración a propósito: publicar por API depende de un convenio comercial
 * con cada portal que puede tardar meses y que no controlamos. El generador
 * funciona hoy — el usuario copia y pega — y cuando el convenio llegue, la
 * integración consume exactamente este mismo aviso.
 */

export interface PropiedadParaAviso {
  tipo: string;
  calle: string;
  numero?: string | null;
  piso?: string | null;
  localidad?: string | null;
  provincia?: string | null;
  supTotal?: number | null;
  supCubierta?: number | null;
  ambientes?: number | null;
  dormitorios?: number | null;
  banos?: number | null;
  cocheras?: number | null;
  antiguedad?: number | null;
  orientacion?: string | null;
  amenities?: string[];
  descripcion?: string | null;
}

export interface OperacionParaAviso {
  tipo: 'venta' | 'alquiler' | 'alquiler_temporario';
  precio?: number | null;
  moneda: string;
  expensas?: number | null;
  expensasMoneda?: string;
}

export interface Aviso {
  titulo: string;
  descripcion: string;
  atributos: Array<{ clave: string; valor: string }>;
  precioTexto: string;
  /** Texto plano completo, listo para pegar en el formulario de un portal. */
  paraPegar: string;
  /** Lo que le falta al aviso para ser competitivo. */
  faltantes: string[];
}

const LIMITE_TITULO = 60;

export function generarAviso(
  p: PropiedadParaAviso,
  o: OperacionParaAviso,
): Aviso {
  const tipo = ETIQUETA_TIPO[p.tipo] ?? p.tipo;
  const operacion =
    o.tipo === 'venta' ? 'en venta' : o.tipo === 'alquiler' ? 'en alquiler' : 'temporario';

  // El título arranca por lo que la gente filtra: tipo, ambientes y zona.
  const partesTitulo = [tipo];
  if (p.ambientes) partesTitulo.push(`${p.ambientes} ambientes`);
  else if (p.dormitorios) partesTitulo.push(`${p.dormitorios} dormitorios`);
  partesTitulo.push(operacion);
  if (p.localidad) partesTitulo.push(`en ${p.localidad}`);

  let titulo = partesTitulo.join(' ');
  if (titulo.length > LIMITE_TITULO) {
    // Los portales cortan el título; mejor cortarlo nosotros. Dos pasos:
    // primero por palabra entera, y después soltando la preposición o el
    // artículo que quede colgando al final — "Villa Nueva de" se lee peor que
    // "Villa Nueva".
    titulo = titulo.slice(0, LIMITE_TITULO).replace(/\s+\S*$/, '');
    titulo = titulo.replace(/\s+(de|del|en|la|el|los|las|y|a|con|por)$/i, '');
  }

  const atributos: Array<{ clave: string; valor: string }> = [];
  const push = (clave: string, valor: unknown, sufijo = '') => {
    if (valor !== null && valor !== undefined && valor !== '') {
      atributos.push({ clave, valor: `${valor}${sufijo}` });
    }
  };

  push('Tipo', tipo);
  push('Superficie total', p.supTotal, ' m²');
  push('Superficie cubierta', p.supCubierta, ' m²');
  push('Ambientes', p.ambientes);
  push('Dormitorios', p.dormitorios);
  push('Baños', p.banos);
  push('Cocheras', p.cocheras);
  push('Antigüedad', p.antiguedad, ' años');
  push('Orientación', p.orientacion);
  if (p.amenities?.length) push('Amenities', p.amenities.join(', '));

  const precioTexto = precio(o);

  // La dirección exacta NO va en el aviso: se publica la zona. El número de
  // puerta es para el interesado que ya llamó, no para el portal.
  const zona = [p.localidad, p.provincia].filter(Boolean).join(', ');

  const cuerpo = [
    p.descripcion?.trim(),
    zona ? `Ubicación: ${zona}.` : null,
    atributos.length
      ? atributos.map((a) => `· ${a.clave}: ${a.valor}`).join('\n')
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const paraPegar = [titulo, '', precioTexto, '', cuerpo].join('\n');

  return {
    titulo,
    descripcion: cuerpo,
    atributos,
    precioTexto,
    paraPegar,
    faltantes: faltantes(p, o),
  };
}

function precio(o: OperacionParaAviso): string {
  if (o.precio === null || o.precio === undefined) return 'Consultar precio';
  const fmt = (n: number, m: string) =>
    `${m} ${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;

  const base = fmt(o.precio, o.moneda);
  return o.expensas
    ? `${base} + ${fmt(o.expensas, o.expensasMoneda ?? o.moneda)} de expensas`
    : base;
}

/**
 * Qué le falta al aviso. No bloquea nada: se muestra para que el usuario
 * decida. Un aviso sin fotos se publica igual, sólo rinde menos.
 */
function faltantes(p: PropiedadParaAviso, o: OperacionParaAviso): string[] {
  const f: string[] = [];
  if (!p.descripcion?.trim()) f.push('descripción');
  if (o.precio === null || o.precio === undefined) f.push('precio');
  if (!p.supTotal && !p.supCubierta) f.push('superficie');
  if (!p.ambientes && !p.dormitorios) f.push('ambientes o dormitorios');
  if (!p.localidad) f.push('localidad');
  return f;
}

/**
 * Feed XML de la cartera. Formato propio y estable, pensado para que un portal
 * o un desarrollador externo lo consuma sin acuerdo previo.
 */
export interface ItemFeed {
  codigo: string;
  operacion: string;
  aviso: Aviso;
  lat?: number | null;
  lng?: number | null;
  actualizado: string;
}

export function generarFeedXml(inmobiliaria: string, items: ItemFeed[]): string {
  const filas = items
    .map(
      (i) => `  <propiedad>
    <codigo>${esc(i.codigo)}</codigo>
    <operacion>${esc(i.operacion)}</operacion>
    <titulo>${esc(i.aviso.titulo)}</titulo>
    <precio>${esc(i.aviso.precioTexto)}</precio>
    <descripcion>${esc(i.aviso.descripcion)}</descripcion>
${i.aviso.atributos
  .map((a) => `    <atributo nombre="${esc(a.clave)}">${esc(a.valor)}</atributo>`)
  .join('\n')}
${i.lat != null && i.lng != null ? `    <ubicacion lat="${i.lat}" lng="${i.lng}"/>` : ''}
    <actualizado>${esc(i.actualizado)}</actualizado>
  </propiedad>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<cartera generado="${new Date().toISOString()}" inmobiliaria="${esc(inmobiliaria)}">
${filas}
</cartera>
`;
}

/** Escapa para XML. Sin esto, una descripción con "&" rompe el feed entero. */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
