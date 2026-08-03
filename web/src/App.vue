<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from './stores/auth';
import { cuandoSePierdaLaSesion } from './api/cliente';
import AppShell from './componentes/AppShell.vue';

const auth = useAuth();
const router = useRouter();
const route = useRoute();

// Si la renovación falla, se cierra la sesión y se vuelve al login con aviso.
// Silencioso sería peor: el usuario vería la app vacía sin saber por qué.
cuandoSePierdaLaSesion(() => {
  auth.limpiar();
  router.replace({ path: '/login', query: { motivo: 'expirada' } });
});

/**
 * El layout lo decide la RUTA, no el estado de sesión. Atarlo a
 * `auth.autenticado` hace que alguien logueado que abre una invitación vea la
 * pantalla partida metida adentro del shell.
 */
const sinShell = computed(() => route.meta.publica === true);
</script>

<template>
  <RouterView v-if="sinShell" />
  <AppShell v-else>
    <RouterView />
  </AppShell>
</template>
