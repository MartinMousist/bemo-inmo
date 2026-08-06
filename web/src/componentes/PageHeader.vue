<script setup lang="ts">
defineProps<{ titulo: string; bajada?: string }>();
</script>

<template>
  <header class="ph">
    <div>
      <h1>{{ titulo }}</h1>
      <p v-if="bajada" class="bajada">{{ bajada }}</p>
    </div>
    <div class="acciones"><slot name="acciones" /></div>
  </header>
</template>

<!-- Sin estilos propios: `.ph` es capa familia, con el `flex-wrap` y el
     `min-width: 0` de `.ph .acciones` que evitan que tres controles en la
     cabecera empujen el ancho de toda la página. -->
