/**
 * Los catálogos cerrados de la migración 027, espejados del back
 * (`propiedades.dto.ts`). Mismas claves, con la etiqueta en castellano que se
 * muestra en el formulario y en el filtro.
 *
 * ── Por qué es un espejo manual y no un import cruzado ──
 *
 * El front y el back son dos proyectos con su propio build; no hay un paquete
 * compartido entre los dos, y el resto del repo ya resuelve esto así (`TIPOS_
 * PROPIEDAD` en el DTO del back, `ETIQUETA_TIPO` acá). Las claves tienen que
 * coincidir letra por letra con `ORIENTACIONES`/`DISPOSICIONES`/`CALEFACCIONES`
 * /`AMENITIES` del DTO — si un test de API manda una clave que no está acá, el
 * filtro se ve pero no hace nada, que es peor que un error.
 */

export interface Opcion {
  clave: string;
  etiqueta: string;
}

export const ORIENTACIONES: Opcion[] = [
  { clave: 'norte', etiqueta: 'Norte' },
  { clave: 'noreste', etiqueta: 'Noreste' },
  { clave: 'este', etiqueta: 'Este' },
  { clave: 'sureste', etiqueta: 'Sureste' },
  { clave: 'sur', etiqueta: 'Sur' },
  { clave: 'suroeste', etiqueta: 'Suroeste' },
  { clave: 'oeste', etiqueta: 'Oeste' },
  { clave: 'noroeste', etiqueta: 'Noroeste' },
];

export const DISPOSICIONES: Opcion[] = [
  { clave: 'frente', etiqueta: 'Frente' },
  { clave: 'contrafrente', etiqueta: 'Contrafrente' },
  { clave: 'lateral', etiqueta: 'Lateral' },
  { clave: 'interno', etiqueta: 'Interno' },
];

export const CALEFACCIONES: Opcion[] = [
  { clave: 'central', etiqueta: 'Central' },
  { clave: 'individual', etiqueta: 'Individual' },
  { clave: 'radiadores', etiqueta: 'Por radiadores' },
  { clave: 'losa_radiante', etiqueta: 'Losa radiante' },
  { clave: 'aire_frio_calor', etiqueta: 'Aire frío/calor' },
  { clave: 'a_lena', etiqueta: 'A leña' },
  { clave: 'sin_calefaccion', etiqueta: 'Sin calefacción' },
];

/**
 * Migración 028. `condominio` es el LOTEO —un conjunto chico de unidades con
 * espacios comunes—, no la titularidad compartida que ya usa esa palabra en
 * la ficha de una propiedad (dos dueños al 50%): son dos sentidos del rubro
 * que coinciden en el nombre y no tienen relación entre sí.
 */
export const URBANIZACIONES: Opcion[] = [
  { clave: 'abierto', etiqueta: 'Barrio abierto' },
  { clave: 'barrio_privado', etiqueta: 'Barrio privado' },
  { clave: 'country', etiqueta: 'Country' },
  { clave: 'condominio', etiqueta: 'Condominio' },
];

/**
 * Amenities agrupados sólo para la pantalla — el back los valida como una
 * lista plana (`AMENITIES` en el DTO), la agrupación es un detalle de cómo se
 * ofrecen los checkboxes y no cambia el contrato.
 *
 * Los primeros seis grupos de "Unidad" y buena parte de "Edificio" son los
 * que ya usan los datos de la demo (`ascensor`, `balcon`, `deposito`,
 * `parque`, `parrilla`, `patio`, `pileta`, `quincho`, `seguridad`, `sum`,
 * `vidriera`) — se muestran igual que el resto, no hace falta distinguirlos.
 */
export const AMENITIES_AGRUPADOS: Array<{ categoria: string; items: Opcion[] }> = [
  {
    categoria: 'Edificio',
    items: [
      { clave: 'pileta', etiqueta: 'Pileta' },
      { clave: 'sum', etiqueta: 'SUM' },
      { clave: 'gimnasio', etiqueta: 'Gimnasio' },
      { clave: 'solarium', etiqueta: 'Solárium' },
      { clave: 'laundry', etiqueta: 'Laundry' },
      { clave: 'cowork', etiqueta: 'Cowork' },
      { clave: 'ascensor', etiqueta: 'Ascensor' },
      { clave: 'generador', etiqueta: 'Grupo electrógeno' },
    ],
  },
  {
    categoria: 'Unidad',
    items: [
      { clave: 'balcon', etiqueta: 'Balcón' },
      { clave: 'terraza', etiqueta: 'Terraza' },
      { clave: 'patio', etiqueta: 'Patio' },
      { clave: 'jardin', etiqueta: 'Jardín' },
      { clave: 'parque', etiqueta: 'Parque' },
      { clave: 'quincho', etiqueta: 'Quincho' },
      { clave: 'parrilla', etiqueta: 'Parrilla' },
      { clave: 'deposito', etiqueta: 'Depósito' },
      { clave: 'baulera', etiqueta: 'Baulera' },
      { clave: 'placards', etiqueta: 'Placards' },
      { clave: 'vestidor', etiqueta: 'Vestidor' },
      { clave: 'lavadero', etiqueta: 'Lavadero' },
      { clave: 'aire_acondicionado', etiqueta: 'Aire acondicionado' },
      { clave: 'vidriera', etiqueta: 'Vidriera' },
    ],
  },
  {
    categoria: 'Seguridad',
    items: [
      { clave: 'seguridad', etiqueta: 'Seguridad 24 hs' },
      { clave: 'portero', etiqueta: 'Portero' },
      { clave: 'camaras', etiqueta: 'Cámaras' },
      { clave: 'alarma', etiqueta: 'Alarma' },
    ],
  },
  {
    categoria: 'Aptitud',
    items: [
      { clave: 'apto_credito', etiqueta: 'Apto crédito' },
      { clave: 'apto_profesional', etiqueta: 'Apto profesional' },
      { clave: 'apto_comercial', etiqueta: 'Apto comercial' },
      { clave: 'pet_friendly', etiqueta: 'Pet friendly' },
      { clave: 'amoblado', etiqueta: 'Amoblado' },
      { clave: 'luminoso', etiqueta: 'Luminoso' },
    ],
  },
];

/** Lista plana, para buscar la etiqueta de una clave sin recorrer los grupos. */
const AMENITIES_POR_CLAVE: Record<string, string> = Object.fromEntries(
  AMENITIES_AGRUPADOS.flatMap((g) => g.items).map((i) => [i.clave, i.etiqueta]),
);

function etiquetaDe(lista: Opcion[], clave: string | null | undefined): string {
  return lista.find((o) => o.clave === clave)?.etiqueta ?? clave ?? '—';
}

export const etiquetaOrientacion = (c?: string | null): string => etiquetaDe(ORIENTACIONES, c);
export const etiquetaDisposicion = (c?: string | null): string => etiquetaDe(DISPOSICIONES, c);
export const etiquetaCalefaccion = (c?: string | null): string => etiquetaDe(CALEFACCIONES, c);
export const etiquetaUrbanizacion = (c?: string | null): string => etiquetaDe(URBANIZACIONES, c);
export const etiquetaAmenity = (c: string): string => AMENITIES_POR_CLAVE[c] ?? c;
