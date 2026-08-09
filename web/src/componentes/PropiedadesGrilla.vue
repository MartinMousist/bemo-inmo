<script setup lang="ts">
import PropiedadCard from './PropiedadCard.vue';
import type { PropiedadTarjeta } from '../dominio/propiedad';

/**
 * La grilla de tarjetas.
 *
 * Existe como componente y no como tres `<div class="grilla">` copiados por la
 * misma razón por la que `CarteraPropiedadesPage` es un componente con dos
 * rutas: lo que cambia entre Propiedades, la cartera de venta y la de alquiler
 * es qué operación se destaca, no la grilla. Tres copias divergen en el primer
 * arreglo que se haga en una sola.
 *
 * **No trae el estado vacío**, a propósito: las tres pantallas dicen cosas
 * distintas cuando no hay nada («Ninguna propiedad en venta» explica que una
 * propiedad entra ahí al cargarle una operación de venta) y meter ese copy acá
 * obligaría a pasarlo por props, o sea a mover el texto de lugar sin
 * compartirlo. El vacío se queda en cada pantalla, con su `UiEmpty`.
 *
 * El skeleton SÍ está: en modo tarjetas el `UiSkeleton` de filas se ve como una
 * tabla que después se convierte en una grilla, y ese salto es justo lo que el
 * skeleton existe para evitar.
 */
defineProps<{
  items: PropiedadTarjeta[];
  modo?: 'general' | 'venta' | 'alquiler';
  cargando?: boolean;
  /** Cuántas tarjetas fantasma dibujar mientras carga. */
  esqueletos?: number;
}>();
</script>

<template>
  <div v-if="cargando" class="grilla" aria-hidden="true">
    <!-- Cada fantasma tiene la MISMA proporción que una tarjeta real: bloque
         4:3 arriba y tres renglones abajo. Un rectángulo de alto arbitrario
         haría saltar el layout al llegar los datos. -->
    <div v-for="n in esqueletos ?? 8" :key="n" class="fantasma">
      <div class="sk media" />
      <div class="sk linea corta" />
      <div class="sk linea" />
      <div class="sk linea media-linea" />
    </div>
  </div>

  <div v-else class="grilla">
    <PropiedadCard
      v-for="p in items"
      :key="p.id"
      :propiedad="p"
      :modo="modo"
    />
  </div>
</template>

<style scoped>
/* `auto-fill` y no `auto-fit`: con pocas propiedades, `auto-fit` estira las
   tarjetas hasta ocupar el ancho entero y una sola propiedad queda con una
   foto de 1200px de ancho. Con `auto-fill` la tarjeta conserva su tamaño y las
   columnas vacías quedan vacías, que es lo correcto en un listado.
   240px de mínimo: abajo de eso el precio en mono 17px y su chip no entran en
   la misma línea. */
/* Sin `align-items: start`: las tarjetas de una fila se estiran a la misma
   altura. Con `start`, una dirección de dos renglones dejaba su tarjeta más
   alta que las vecinas y la fila quedaba con escalones — visto en la grilla con
   las 34 propiedades del seed, no razonado. */
.grilla {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--s-lg);
}

.fantasma {
  display: flex;
  flex-direction: column;
  gap: var(--s-sm);
  padding-bottom: var(--s-md);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  overflow: clip;
}
.fantasma .media { aspect-ratio: 4 / 3; border-radius: 0; }
.fantasma .linea { height: 12px; margin: 0 var(--s-lg); }
.fantasma .corta { width: 40%; }
.fantasma .media-linea { width: 70%; }
</style>
