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

<style scoped>
.ph {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s-lg);
  flex-wrap: wrap;
}
h1 { font-size: 24px; }
.bajada {
  margin: var(--s-xs) 0 0;
  color: var(--muted);
  font-size: 13px;
}
.acciones {
  display: flex;
  gap: var(--s-sm);
  align-items: center;
  /* Envuelven en pantalla angosta.
     Sin esto, tres controles en la cabecera —un selector de mes y dos botones,
     como en Liquidaciones— suman más de 375px y empujan el ancho de TODA la
     página: el desborde no se ve en la cabecera, se ve como una barra de scroll
     horizontal en el listado de abajo. */
  flex-wrap: wrap;
  /* `min-width: 0` deja que el bloque se achique antes de desbordar; sin él,
     flex lo mantiene en su ancho de contenido. */
  min-width: 0;
}
</style>
