<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { etiquetaRol } from '../dominio/roles';
import UiIcon from './UiIcon.vue';
import CommandPalette from './CommandPalette.vue';

const auth = useAuth();
const router = useRouter();

/** Sidebar agrupado por función, no una lista plana de 12 ítems. */
const grupos = [
  {
    titulo: 'Cartera',
    items: [
      { a: '/propiedades', icono: 'edificio', texto: 'Propiedades' },
      { a: '/personas', icono: 'personas', texto: 'Personas' },
    ],
  },
  {
    titulo: 'Comercial',
    items: [
      { a: '/oportunidades', icono: 'embudo', texto: 'Oportunidades' },
      { a: '/reservas', icono: 'sena', texto: 'Reservas' },
    ],
  },
  {
    titulo: 'Administración',
    items: [{ a: '/equipo', icono: 'equipo', texto: 'Equipo' }],
  },
];

const drawerAbierto = ref(false);
const paletaAbierta = ref(false);

const iniciales = computed(() =>
  (auth.usuario?.nombre ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join(''),
);

const tema = ref<'light' | 'dark'>(
  (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'light',
);

function alternarTema() {
  tema.value = tema.value === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', tema.value);
  localStorage.setItem('bemo-inmo:theme', tema.value);
}

async function salir() {
  await auth.logout();
  router.replace('/login');
}

// ⌘K / Ctrl+K abre la paleta desde cualquier pantalla.
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    paletaAbierta.value = true;
  }
});
</script>

<template>
  <div class="shell">
    <aside class="sidebar" :class="{ abierto: drawerAbierto }">
      <div class="marca">
        <RouterLink to="/propiedades">Bemo <span>INMO</span></RouterLink>
      </div>

      <nav>
        <div v-for="g in grupos" :key="g.titulo" class="grupo">
          <p class="grupo-titulo">{{ g.titulo }}</p>
          <RouterLink
            v-for="i in g.items"
            :key="i.a"
            :to="i.a"
            class="nav-item"
            @click="drawerAbierto = false"
          >
            <UiIcon :nombre="i.icono" />
            <span>{{ i.texto }}</span>
          </RouterLink>
        </div>
      </nav>

      <button class="atajo" type="button" @click="paletaAbierta = true">
        <UiIcon nombre="buscar" />
        <span>Buscar</span>
        <kbd>⌘K</kbd>
      </button>
    </aside>

    <div v-if="drawerAbierto" class="velo-drawer" @click="drawerAbierto = false" />

    <div class="principal">
      <header class="topbar">
        <button class="hamburguesa" type="button" aria-label="Menú" @click="drawerAbierto = true">
          <UiIcon nombre="menu" />
        </button>

        <span class="tenant">{{ auth.tenant?.nombre }}</span>

        <div class="row">
          <span class="chip">{{ etiquetaRol(auth.rol) }}</span>
          <span class="avatar" :title="auth.usuario?.nombre ?? ''">{{ iniciales }}</span>
          <button
            class="icon-btn"
            type="button"
            :aria-label="tema === 'dark' ? 'Tema claro' : 'Tema oscuro'"
            @click="alternarTema"
          >
            <UiIcon :nombre="tema === 'dark' ? 'sol' : 'luna'" />
          </button>
          <button class="icon-btn" type="button" aria-label="Salir" @click="salir">
            <UiIcon nombre="salir" />
          </button>
        </div>
      </header>

      <main class="contenido">
        <slot />
      </main>
    </div>

    <CommandPalette v-model:abierta="paletaAbierta" />
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: 232px 1fr;
  min-height: 100vh;
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--s-xl);
  padding: var(--s-lg);
  background: var(--surface-2);
  border-right: 1px solid var(--line);
}

.marca a {
  font-family: var(--font-title);
  font-size: 18px;
  color: var(--ink);
  text-decoration: none;
  padding: var(--s-sm);
  display: inline-block;
}
.marca span {
  font-family: var(--font-ui);
  font-weight: 400;
  color: var(--accent);
}

nav {
  display: flex;
  flex-direction: column;
  gap: var(--s-xl);
  flex: 1;
}

.grupo-titulo {
  margin: 0 0 var(--s-xs) var(--s-sm);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted-2);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--s-md);
  padding: var(--s-sm) var(--s-md);
  border-radius: var(--r-md);
  color: var(--ink-2);
  text-decoration: none;
  transition: background var(--t-micro), color var(--t-micro);
}
.nav-item:hover {
  background: var(--surface-3);
}
.nav-item.router-link-active {
  background: var(--accent-tint);
  color: var(--accent);
  font-weight: 500;
}

.atajo {
  display: flex;
  align-items: center;
  gap: var(--s-sm);
  padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.atajo:hover {
  color: var(--ink-2);
}
.atajo kbd {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted-2);
}

.principal {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  display: flex;
  align-items: center;
  gap: var(--s-md);
  padding: var(--s-md) var(--s-xl);
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.topbar .row {
  margin-left: auto;
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

.icon-btn {
  display: inline-flex;
  padding: 6px;
  border: 1px solid transparent;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.icon-btn:hover {
  background: var(--surface-2);
  color: var(--ink-2);
}

.contenido {
  flex: 1;
  padding: var(--s-2xl) var(--s-xl);
  max-width: 1100px;
  width: 100%;
}

/* `velo-drawer` y no `velo`: el CSS scoped del padre alcanza al elemento RAÍZ
   del componente hijo, así que un `.velo { display: none }` acá le pegaba
   también a la raíz de CommandPalette y la paleta nunca se veía. */
.hamburguesa,
.velo-drawer {
  display: none;
}

@media (max-width: 900px) {
  .shell {
    grid-template-columns: 1fr;
  }
  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    width: 232px;
    z-index: 30;
    transform: translateX(-100%);
    transition: transform var(--t-short);
  }
  .sidebar.abierto {
    transform: none;
  }
  .velo-drawer {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 20;
    background: rgba(26, 24, 21, 0.35);
  }
  .hamburguesa {
    display: inline-flex;
    padding: 6px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--ink-2);
    cursor: pointer;
  }
  .contenido {
    padding: var(--s-xl) var(--s-lg);
  }
}
</style>
