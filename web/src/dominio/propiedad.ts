import type { AtributosDePropiedad, SuperficieDePropiedad } from './atributos';

/**
 * Lo que una propiedad necesita traer para poder dibujarse como tarjeta.
 *
 * Vive acá y no adentro de `PropiedadCard.vue` por una razón mecánica: un
 * bloque `<script setup>` **no puede tener exports con nombre**, así que un
 * tipo declarado ahí no se puede importar desde la grilla ni desde las tres
 * pantallas que la usan. La alternativa era declararlo cuatro veces, que es
 * cómo empiezan las divergencias que este trabajo vino a arreglar.
 *
 * Es un subconjunto de lo que devuelve `GET /v1/propiedades`, no una copia: la
 * tarjeta pide lo que muestra y nada más. Cada pantalla puede tener su propia
 * interfaz más ancha —con honorarios, con captador— y pasarla igual.
 */
export interface OperacionDeTarjeta {
  id: string;
  tipo: string;
  precio: number | null;
  moneda: string;
  estado: string;
}

export interface PropiedadTarjeta extends AtributosDePropiedad, SuperficieDePropiedad {
  id: string;
  etiqueta: string;
  direccion: string;
  /** La portada, o `null` si no tiene fotos. Nunca `''`. */
  fotoPortada?: string | null;
  operaciones: OperacionDeTarjeta[];
}
