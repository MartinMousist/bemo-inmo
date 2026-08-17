import type { TipoCuenta } from './modulos.motor';

/**
 * Qué paneles le corresponden a cada cuenta en Inicio y en el Tablero. PURO:
 * entra el perfil, sale qué se calcula y qué no.
 *
 * ── Por qué existe ──
 *
 * La etapa 13 dejó el tipo de cuenta funcionando en el MENÚ: un gestor de
 * alquileres no ve Leads, Ventas, Comisiones, Publicaciones ni Reservas. Pero
 * esconder cinco entradas no es adaptar el producto. El gestor abría el Tablero
 * y encontraba embudo de conversión, ranking de asesores y comisiones por
 * cobrar: le sacamos las secciones y le dejamos los KPIs de otro negocio.
 *
 * ── Las tres decisiones ──
 *
 * **Se mira el MÓDULO, no el tipo.** Podría preguntarse `tipo === 'gestor'` y
 * sería más corto. Sería también un segundo mecanismo compitiendo con el que ya
 * existe: hoy cualquiera puede prender Leads desde Ajustes, y con la pregunta
 * por el tipo el embudo quedaría escondido para siempre igual, sin explicación.
 * Atado al módulo, prenderlo devuelve su panel — que es lo que el interruptor
 * promete.
 *
 * **Lo que no se muestra no se calcula.** Es el mismo criterio que `vePlata`:
 * las consultas del embudo no corren para una cuenta que no tiene Leads. No es
 * sólo velocidad —son cuatro consultas menos por Tablero—; es que un dato que
 * no se pidió no tiene por qué viajar.
 *
 * **Los honorarios NO son de venta.** `honorariosDevengados` suma comisiones de
 * venta Y honorarios de liquidación, y esos segundos son exactamente de lo que
 * vive un gestor: es su ingreso propio, el único número del producto que no es
 * plata de terceros. Sacarle el panel entero por no vender le escondería lo que
 * más mira. Se van sólo las dos piezas que son de venta y nada más: las
 * comisiones por cobrar y el ranking por asesor.
 */

export interface Perfil {
  tipo: TipoCuenta;
  /** Las claves de módulo prendidas. Es lo que decide, no el tipo. */
  activos: string[];
}

/** Qué trae el resumen de Inicio. */
export interface PanelesInicio {
  /**
   * El embudo enfriándose. Sin Leads no hay embudo: la lista saldría siempre
   * vacía y una tarjeta que nunca tiene nada enseña a ignorar la pantalla.
   */
  oportunidadesFrias: boolean;
  /**
   * Cuántas unidades están sin alquilar.
   *
   * Para una inmobiliaria es un dato más entre la venta y la captación. Para
   * quien vive de administrar, una unidad vacía es el mes que no cobra: es SU
   * número, y hasta ahora estaba sumado adentro de «disponibles» junto con las
   * que están en venta.
   */
  unidadesVacias: boolean;
}

/** Qué trae el Tablero. */
export interface PanelesTablero {
  /** Etapas, origen y motivos de pérdida. Vive de Leads. */
  embudo: boolean;
  /** Honorarios devengados: de venta Y de liquidación. Los dos perfiles. */
  honorarios: boolean;
  /** Comisiones de venta todavía sin cobrar. */
  comisionesPorCobrar: boolean;
  /** El ranking por asesor. Sin comisiones no hay qué rankear. */
  rankingPorAgente: boolean;
}

export function panelesDeInicio(p: Perfil): PanelesInicio {
  return {
    oportunidadesFrias: p.activos.includes('leads'),
    // Se le muestra a quien no vende. Una inmobiliaria ya tiene la cartera
    // partida en venta y alquiler en su propio menú.
    unidadesVacias: !p.activos.includes('ventas'),
  };
}

export function panelesDelTablero(p: Perfil): PanelesTablero {
  const comisiones = p.activos.includes('comisiones');
  return {
    embudo: p.activos.includes('leads'),
    honorarios: true,
    // Las dos cuelgan de `comision`, que sólo se escribe al repartir una venta
    // o un contrato. Sin el módulo, las dos consultas devuelven cero filas y el
    // panel muestra un cero que no significa «no cobré»: significa «acá no se
    // mide eso».
    comisionesPorCobrar: comisiones,
    rankingPorAgente: comisiones,
  };
}
