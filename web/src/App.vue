<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from './stores/auth';
import { cuandoSePierdaLaSesion } from './api/cliente';
import { etiquetaRol } from './dominio/roles';

const auth = useAuth();
const router = useRouter();
const route = useRoute();

/**
 * El layout lo decide la RUTA, no el estado de sesión.
 *
 * Atarlo a `auth.autenticado` parece equivalente y no lo es: alguien logueado
 * que abre un enlace de invitación termina viendo la pantalla partida metida
 * adentro del shell, con la topbar arriba. La ruta sabe qué layout le
 * corresponde; el estado de sesión no.
 */
const sinShell = computed(() => route.meta.publica === true);

// Si la renovación falla, se cierra la sesión y se vuelve al login con aviso.
// Silencioso sería peor: el usuario vería la app vacía sin saber por qué.
cuandoSePierdaLaSesion(() => {
  auth.limpiar();
  router.replace({ path: '/login', query: { motivo: 'expirada' } });
});

const tema = ref<'light' | 'dark'>(
  (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'light',
);

function alternarTema() {
  tema.value = tema.value === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', tema.value);
  localStorage.setItem('bemo-inmo:theme', tema.value);
}

const iniciales = computed(() =>
  (auth.usuario?.nombre ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join(''),
);

async function salir() {
  await auth.logout();
  router.replace('/login');
}
</script>

<template>
  <!-- Login, registro e invitación traen su propio layout partido. -->
  <RouterView v-if="sinShell" />

  <div v-else class="shell">
    <header class="topbar">
      <div class="marca">Bemo <span>INMO</span></div>
      <div class="row">
        <span class="tenant">{{ auth.tenant?.nombre }}</span>
        <span class="chip">{{ etiquetaRol(auth.rol) }}</span>
        <span class="avatar" :title="auth.usuario?.nombre">{{ iniciales }}</span>
        <button class="btn secondary sm" type="button" @click="alternarTema">
          {{ tema === 'dark' ? 'Claro' : 'Oscuro' }}
        </button>
        <button class="btn secondary sm" type="button" @click="salir">Salir</button>
      </div>
    </header>

    <main class="contenido">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-lg);
  padding: var(--s-md) var(--s-xl);
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}

.marca {
  font-family: var(--font-title);
  font-size: 18px;
}
.marca span {
  font-family: var(--font-ui);
  font-weight: 400;
  color: var(--accent);
}

.tenant {
  color: var(--muted);
  font-size: 13px;
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent-tint);
  border: 1px solid var(--accent-line);
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
}

.btn.sm {
  padding: 4px var(--s-md);
  font-size: 12px;
}

.contenido {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--s-2xl) var(--s-xl);
}
</style>
