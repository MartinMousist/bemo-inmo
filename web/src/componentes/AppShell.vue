<script setup lang="ts">
import { ref } from 'vue';
import { useAuth } from '../stores/auth';
import UiIcon from './UiIcon.vue';
import BemoLogo from './BemoLogo.vue';
import MenuUsuario from './MenuUsuario.vue';
import CommandPalette from './CommandPalette.vue';

const auth = useAuth();

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
    titulo: 'Alquileres',
    items: [
      { a: '/avisos', icono: 'campana', texto: 'Avisos' },
      { a: '/vencimientos', icono: 'calendario', texto: 'Vencimientos' },
      { a: '/contratos', icono: 'documento', texto: 'Contratos' },
      { a: '/liquidaciones', icono: 'moneda', texto: 'Liquidaciones' },
      { a: '/indices', icono: 'grafico', texto: 'Índices' },
    ],
  },
  {
    titulo: 'Comercial',
    items: [
      { a: '/oportunidades', icono: 'embudo', texto: 'Oportunidades' },
      { a: '/reservas', icono: 'sena', texto: 'Reservas' },
      { a: '/ventas', icono: 'grafico', texto: 'Ventas' },
      { a: '/publicaciones', icono: 'mapa', texto: 'Publicaciones' },
    ],
  },
  {
    titulo: 'Administración',
    items: [{ a: '/equipo', icono: 'equipo', texto: 'Equipo' }],
  },
];

const drawerAbierto = ref(false);
const paletaAbierta = ref(false);

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
      <RouterLink to="/propiedades" class="marca">
        <BemoLogo :tam="30" con-nombre />
      </RouterLink>

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
        <span class="separador" />

        <MenuUsuario />
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

.marca {
  display: inline-flex;
  padding: var(--s-sm);
  border-radius: var(--r-md);
  text-decoration: none;
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
.separador {
  margin-left: auto;
}

.tenant {
  color: var(--muted);
  font-size: 13px;
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
