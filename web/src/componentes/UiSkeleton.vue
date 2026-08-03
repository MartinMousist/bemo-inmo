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

<style scoped>
.sk-wrap { display: flex; flex-direction: column; gap: var(--s-sm); }
.sk {
  border-radius: var(--r-md);
  background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2));
  background-size: 200% 100%;
  animation: brillo 1.2s ease-in-out infinite;
}
@keyframes brillo { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) {
  .sk { animation: none; }
}
</style>
