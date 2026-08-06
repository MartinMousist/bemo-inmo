/**
 * Los campos y el mapeo que alimentan al generador de aviso.
 *
 * Viven acá y no adentro del servicio porque hay **tres** lugares que arman el
 * mismo aviso con exactamente los mismos campos: publicar una operación, el
 * feed XML de la cartera y el seed demo. Estaba escrito dos veces —el `SELECT`
 * del feed y el de `datosDeOperacion` eran el mismo, columna por columna— y la
 * tercera copia iba a ser la que quedara vieja: agregar `expensas` al motor y
 * olvidarse de una de las consultas da un aviso distinto según por dónde se
 * pidió, que es de los errores que no se ven hasta que un propietario compara.
 */
import type { OperacionParaAviso, PropiedadParaAviso } from './aviso.motor';

/** Lo que devuelve `CAMPOS_AVISO`. `numeric` viene como texto desde `pg`. */
export interface FilaAviso {
  codigo: number;
  tipo: string;
  calle: string;
  numero: string | null;
  piso: string | null;
  localidad: string | null;
  provincia: string | null;
  sup_total: string | null;
  sup_cubierta: string | null;
  ambientes: number | null;
  dormitorios: number | null;
  banos: number | null;
  cocheras: number | null;
  antiguedad: number | null;
  orientacion: string | null;
  amenities: string[];
  descripcion: string | null;
  lat: string | null;
  lng: string | null;
  op_tipo: string;
  precio: string | null;
  moneda: string;
  expensas: string | null;
  expensas_moneda: string;
  updated_at: Date;
}

/** Las columnas, tal cual. Se usa como `SELECT ${CAMPOS_AVISO} FROM operacion o JOIN propiedad pr ...`. */
export const CAMPOS_AVISO = `pr.codigo, pr.tipo, pr.calle, pr.numero, pr.piso, pr.localidad,
       pr.provincia, pr.sup_total, pr.sup_cubierta, pr.ambientes,
       pr.dormitorios, pr.banos, pr.cocheras, pr.antiguedad,
       pr.orientacion, pr.amenities, pr.descripcion, pr.lat, pr.lng,
       o.tipo AS op_tipo, o.precio, o.moneda, o.expensas,
       o.expensas_moneda, o.updated_at`;

export function datosParaAviso(r: FilaAviso): {
  propiedad: PropiedadParaAviso;
  operacion: OperacionParaAviso;
} {
  return {
    propiedad: {
      tipo: r.tipo, calle: r.calle, numero: r.numero, piso: r.piso,
      localidad: r.localidad, provincia: r.provincia,
      supTotal: n(r.sup_total), supCubierta: n(r.sup_cubierta),
      ambientes: r.ambientes, dormitorios: r.dormitorios, banos: r.banos,
      cocheras: r.cocheras, antiguedad: r.antiguedad,
      orientacion: r.orientacion, amenities: r.amenities,
      descripcion: r.descripcion,
    },
    operacion: {
      tipo: r.op_tipo as 'venta' | 'alquiler' | 'alquiler_temporario',
      precio: n(r.precio), moneda: r.moneda,
      expensas: n(r.expensas), expensasMoneda: r.expensas_moneda,
    },
  };
}

function n(v: string | null): number | null {
  return v === null ? null : Number(v);
}
