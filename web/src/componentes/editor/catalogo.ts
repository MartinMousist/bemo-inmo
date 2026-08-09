/**
 * La forma del catálogo que devuelve `GET /v1/plantillas/variables`.
 *
 * Sólo los tipos: **la lista vive en el backend**, al lado de
 * `contextoDeContrato()`. Un catálogo escrito en `web/` se desincroniza del
 * `SELECT` que arma el contexto en la primera sesión en que alguien agregue un
 * campo, y entonces el menú ofrece variables que no existen: la persona inserta
 * «Piso», el documento sale con ««propiedad.piso»» entre comillas angulares y
 * nadie entiende por qué. Acá sólo se declara qué forma tiene lo que llega.
 */

export interface VariableDelCatalogo {
  /** Lo único que el motor entiende. El resto es para la persona. */
  ruta: string;
  /** «Precio mensual», no `contrato.monto`. */
  etiqueta: string;
  grupo: string;
  /** Ya formateado: es la diferencia entre elegir a ciegas y elegir mirando. */
  ejemplo: string;
  formatos: string[];
  soloEn?: string[];
}

export interface BloqueDelCatalogo {
  clase: 'si' | 'para';
  /** En el `si`, la condición. En el `para`, la lista que se recorre. */
  expr: string;
  /** Sólo en el `para`: el nombre con el que se lee cada elemento adentro. */
  item?: string;
  etiqueta: string;
  ayuda: string;
  /** Las variables que existen SÓLO adentro del bloque, con su ruta prefijada. */
  adentro?: VariableDelCatalogo[];
  soloEn?: string[];
}

export interface Catalogo {
  variables: VariableDelCatalogo[];
  bloques: BloqueDelCatalogo[];
  formatos: Array<{ nombre: string; que: string }>;
}
