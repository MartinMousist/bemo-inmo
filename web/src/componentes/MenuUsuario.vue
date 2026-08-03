<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { etiquetaRol } from '../dominio/roles';
import { aplicar, escucharSistema, leerPreferencia, type Preferencia } from '../dominio/tema';
import UiIcon from './UiIcon.vue';

const auth = useAuth();
const router = useRouter();

const abierto = ref(false);
const caja = ref<HTMLElement>();
const preferencia = ref<Preferencia>(leerPreferencia());

const OPCIONES: Array<{ v: Preferencia; texto: string; icono: string }> = [
  { v: 'claro', texto: 'Claro', icono: 'sol' },
  { v: 'oscuro', texto: 'Oscuro', icono: 'luna' },
  { v: 'sistema', texto: 'El del sistema', icono: 'monitor' },
];

const iniciales = computed(() =>
  (auth.usuario?.nombre ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join(''),
);

function elegirTema(p: Preferencia) {
  preferencia.value = p;
  aplicar(p);
}

function afuera(e: MouseEvent) {
  if (abierto.value && caja.value && !caja.value.contains(e.target as Node)) {
    abierto.value = false;
  }
}
function escape(e: KeyboardEvent) {
  if (e.key === 'Escape') abierto.value = false;
}

let dejarDeEscuchar: (() => void) | undefined;

onMounted(() => {
  document.addEventListener('click', afuera);
  document.addEventListener('keydown', escape);
  dejarDeEscuchar = escucharSistema(() => undefined);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', afuera);
  document.removeEventListener('keydown', escape);
  dejarDeEscuchar?.();
});

async function salir() {
  abierto.value = false;
  await auth.logout();
  router.replace('/login');
}
</script>

<template>
  <div ref="caja" class="menu">
    <button
      class="disparador"
      type="button"
      :aria-expanded="abierto"
      aria-haspopup="menu"
      @click="abierto = !abierto"
    >
      <span class="avatar">{{ iniciales }}</span>
      <span class="rol">{{ etiquetaRol(auth.rol) }}</span>
      <UiIcon nombre="chevron" :tam="14" />
    </button>

    <div v-if="abierto" class="panel" role="menu">
      <div class="cabecera">
        <p class="nombre">{{ auth.usuario?.nombre }}</p>
        <p class="tenant">{{ auth.tenant?.nombre }}</p>
      </div>

      <div class="seccion">
        <p class="titulo">Tema</p>
        <button
          v-for="o in OPCIONES"
          :key="o.v"
          class="opcion"
          type="button"
          role="menuitemradio"
          :aria-checked="preferencia === o.v"
          @click="elegirTema(o.v)"
        >
          <UiIcon :nombre="o.icono" :tam="15" />
          <span>{{ o.texto }}</span>
          <UiIcon v-if="preferencia === o.v" nombre="tilde" :tam="15" class="tilde" />
        </button>
      </div>

      <div class="seccion sin-borde">
        <button class="opcion" type="button" role="menuitem" @click="salir">
          <UiIcon nombre="salir" :tam="15" />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu {
  position: relative;
}

.disparador {
  display: inline-flex;
  align-items: center;
  gap: var(--s-sm);
  padding: 4px 8px 4px 4px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background var(--t-micro), border-color var(--t-micro);
}
.disparador:hover {
  background: var(--surface-2);
  border-color: var(--line);
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

.rol {
  color: var(--ink-2);
}

.panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 60;
  min-width: 232px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-2);
  overflow: hidden;
}

.cabecera {
  padding: var(--s-md) var(--s-lg);
  border-bottom: 1px solid var(--line);
}
.nombre {
  margin: 0;
  color: var(--ink);
  font-weight: 500;
  font-size: 13px;
}
.tenant {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.seccion {
  padding: var(--s-xs);
  border-bottom: 1px solid var(--line);
}
.seccion.sin-borde {
  border-bottom: none;
}

.titulo {
  margin: var(--s-xs) var(--s-sm) var(--s-xs);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted-2);
}

.opcion {
  display: flex;
  align-items: center;
  gap: var(--s-md);
  width: 100%;
  padding: var(--s-sm) var(--s-md);
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.opcion:hover {
  background: var(--surface-2);
}
.opcion[aria-checked='true'] {
  color: var(--accent);
}
.tilde {
  margin-left: auto;
}
</style>
