<script setup lang="ts">
// Estado vacío CON SALIDA: título, explicación y el botón que lo resuelve.
// Un vacío sin acción deja al usuario sin saber qué hacer.
defineProps<{ titulo: string; detalle?: string }>();
</script>

<template>
  <div class="empty">
    <p class="titulo">{{ titulo }}</p>
    <p v-if="detalle" class="detalle">{{ detalle }}</p>
    <div class="accion"><slot /></div>
  </div>
</template>

<style scoped>
.empty {
  padding: var(--s-3xl) var(--s-xl);
  text-align: center;
}
.titulo {
  margin: 0;
  font-family: var(--font-title);
  font-size: 17px;
  color: var(--ink);
}
.detalle {
  margin: var(--s-xs) auto 0;
  max-width: 46ch;
  color: var(--muted);
  font-size: 13px;
}
.accion { margin-top: var(--s-lg); }
</style>
