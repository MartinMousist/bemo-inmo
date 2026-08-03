<script setup lang="ts">
import UiIcon from './UiIcon.vue';
const valor = defineModel<string>({ required: true });
defineProps<{ placeholder?: string }>();
</script>

<template>
  <div class="buscador">
    <UiIcon nombre="buscar" :tam="16" />
    <input v-model="valor" type="search" :placeholder="placeholder ?? 'Buscar…'" />
  </div>
</template>

<style scoped>
.buscador {
  display: flex;
  align-items: center;
  gap: var(--s-sm);
  padding: 0 var(--s-md);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--muted);
}
.buscador:focus-within { box-shadow: var(--ring); }
.buscador input {
  flex: 1;
  min-width: 0;
  font: inherit;
  padding: var(--s-sm) 0;
  border: none;
  background: transparent;
  color: var(--ink);
}
.buscador input:focus { outline: none; box-shadow: none; }
</style>
