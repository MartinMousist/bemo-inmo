<script setup lang="ts">
import UiIcon from './UiIcon.vue';
const valor = defineModel<string>({ required: true });
defineProps<{ placeholder?: string }>();
</script>

<template>
  <div class="input-icono">
    <UiIcon nombre="buscar" :tam="16" />
    <input v-model="valor" type="search" :placeholder="placeholder ?? 'Buscar…'" />
  </div>
</template>

<!-- Sin estilos propios: `.input-icono` es capa familia — la lupa va dentro del
     campo, no en una caja flex al lado, que es la forma de Bemo MED. -->
