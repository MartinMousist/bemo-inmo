<script setup lang="ts">
// Estado vacío CON SALIDA: título, explicación y el botón que lo resuelve.
// Un vacío sin acción deja al usuario sin saber qué hacer.
defineProps<{ titulo: string; detalle?: string }>();
</script>

<template>
  <div class="estado-vacio">
    <p class="titulo">{{ titulo }}</p>
    <p v-if="detalle" class="detalle">{{ detalle }}</p>
    <div class="accion"><slot /></div>
  </div>
</template>

<!-- Sin estilos propios: `.estado-vacio` es capa familia. Acá adentro se
     llamaba `.empty` y en las pantallas `.vacio` es OTRA cosa (un renglón
     apagado), así que el bloque con salida se quedó con su propio nombre. -->
