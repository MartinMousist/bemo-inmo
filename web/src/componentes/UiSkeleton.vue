<script setup lang="ts">
// Skeleton, nunca un spinner centrado: el spinner salta el layout cuando llegan
// los datos y la pantalla "pega un salto".
withDefaults(defineProps<{ filas?: number; alto?: number }>(), { filas: 4, alto: 40 });
</script>

<template>
  <div class="sk-wrap">
    <div v-for="n in filas" :key="n" class="sk" :style="{ height: alto + 'px' }" />
  </div>
</template>

<!-- Sin estilos propios: `.sk` y `.sk-wrap` son capa familia. El
     `prefers-reduced-motion` global de `familia.css` ya apaga el brillo. -->
