<script setup lang="ts">
/**
 * Encabezado de columna ordenable.
 *
 * Es un `<th>` con un `<button>` adentro, y no un `<th>` con `@click`, por dos
 * razones que no son estéticas: un `th` no entra por teclado y un lector de
 * pantalla no lo anuncia como control. El estado va en `aria-sort`, que es el
 * atributo que los lectores leen; la flecha es la versión visual del mismo
 * dato.
 *
 * El ciclo es asc → desc → **sin orden**. La tercera parada importa: sin ella
 * no hay forma de volver al orden que el backend eligió, que en varias
 * pantallas es el útil (los vencimientos por urgencia, los reclamos por
 * prioridad).
 */
const props = defineProps<{
  /** Clave que se le manda al backend. */
  campo: string;
  /** Campo ordenado ahora, o `null`. */
  actual: string | null;
  dir: 'asc' | 'desc';
  /** Alinea a la derecha, para columnas de números. */
  num?: boolean;
}>();

const emit = defineEmits<{ (e: 'ordenar', campo: string | null, dir: 'asc' | 'desc'): void }>();

function alternar() {
  if (props.actual !== props.campo) return emit('ordenar', props.campo, 'asc');
  if (props.dir === 'asc') return emit('ordenar', props.campo, 'desc');
  return emit('ordenar', null, 'asc');
}
</script>

<template>
  <th
    class="ordenable"
    :class="{ num }"
    :aria-sort="actual === campo ? (dir === 'asc' ? 'ascending' : 'descending') : undefined"
  >
    <button type="button" @click="alternar">
      <span><slot /></span>
      <span class="flecha" aria-hidden="true">{{
        actual === campo ? (dir === 'asc' ? '↑' : '↓') : '↕'
      }}</span>
    </button>
  </th>
</template>
