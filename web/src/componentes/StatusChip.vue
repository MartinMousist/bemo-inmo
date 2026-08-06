<script setup lang="ts">
defineProps<{ texto: string; tono?: 'neutro' | 'ok' | 'warn' | 'err' | 'acento' }>();
</script>

<template>
  <span class="chip" :class="tono ?? 'neutro'">{{ texto }}</span>
</template>

<!-- Sin estilos propios: `.chip` y sus tonos son capa familia y viven en
     `styles/familia.css`. `neutro` es el chip base, sin modificador. -->
