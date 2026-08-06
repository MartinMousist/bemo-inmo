<script setup lang="ts">
defineProps<{ titulo: string; bajada?: string }>();
</script>

<template>
  <header class="ph">
    <div>
      <h1>{{ titulo }}</h1>
      <!--
        `aria-live="polite"`: la bajada es donde vive el conteo —«12 contratos»,
        «3 reclamos»— y cambia sola cuando alguien refiltra o busca. Sin esto,
        quien usa lector filtra y no se entera de que la lista cambió: escucha
        silencio y no sabe si el filtro hizo algo.

        `polite` y no `assertive` porque interrumpir la lectura por un conteo
        que cambia mientras se tipea es peor que esperar a la pausa.
      -->
      <p v-if="bajada" class="bajada" aria-live="polite">{{ bajada }}</p>
    </div>
    <div class="acciones"><slot name="acciones" /></div>
  </header>
</template>

<!-- Sin estilos propios: `.ph` es capa familia, con el `flex-wrap` y el
     `min-width: 0` de `.ph .acciones` que evitan que tres controles en la
     cabecera empujen el ancho de toda la página. -->
