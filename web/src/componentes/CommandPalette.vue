<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/cliente';
import UiIcon from './UiIcon.vue';

/**
 * ⌘K. Navegar, ejecutar acciones y buscar entidades desde un solo lugar.
 * Es lo que hace que una app de gestión se sienta rápida.
 */
const abierta = defineModel<boolean>('abierta', { required: true });
const router = useRouter();

interface Item {
  id: string;
  titulo: string;
  detalle?: string;
  icono: string;
  seccion: string;
  ir: () => void;
}

const NAVEGACION: Item[] = [
  { id: 'n1', titulo: 'Propiedades', icono: 'edificio', seccion: 'Ir a', ir: () => router.push('/propiedades') },
  { id: 'n2', titulo: 'Personas', icono: 'personas', seccion: 'Ir a', ir: () => router.push('/personas') },
  { id: 'n3', titulo: 'Oportunidades', icono: 'embudo', seccion: 'Ir a', ir: () => router.push('/oportunidades') },
  { id: 'n4', titulo: 'Reservas', icono: 'sena', seccion: 'Ir a', ir: () => router.push('/reservas') },
  { id: 'n5', titulo: 'Equipo', icono: 'equipo', seccion: 'Ir a', ir: () => router.push('/equipo') },
  { id: 'a1', titulo: 'Nueva propiedad', icono: 'mas', seccion: 'Crear', ir: () => router.push('/propiedades/nueva') },
  { id: 'a2', titulo: 'Nueva persona', icono: 'mas', seccion: 'Crear', ir: () => router.push('/personas/nueva') },
  { id: 'a3', titulo: 'Nueva oportunidad', icono: 'mas', seccion: 'Crear', ir: () => router.push('/oportunidades/nueva') },
];

const consulta = ref('');
const remotos = ref<Item[]>([]);
const seleccion = ref(0);
const campo = ref<HTMLInputElement>();

const locales = computed(() => {
  const q = consulta.value.trim().toLowerCase();
  if (!q) return NAVEGACION;
  return NAVEGACION.filter((i) => i.titulo.toLowerCase().includes(q));
});

const resultados = computed(() => [...locales.value, ...remotos.value]);

const porSeccion = computed(() => {
  const mapa = new Map<string, Item[]>();
  for (const i of resultados.value) {
    if (!mapa.has(i.seccion)) mapa.set(i.seccion, []);
    mapa.get(i.seccion)!.push(i);
  }
  return [...mapa.entries()];
});

let debounce: ReturnType<typeof setTimeout> | undefined;

watch(consulta, (q) => {
  seleccion.value = 0;
  clearTimeout(debounce);
  if (q.trim().length < 2) {
    remotos.value = [];
    return;
  }
  // Contra el servidor sólo con 2+ caracteres y con debounce: la paleta se
  // escribe rápido y no hace falta una consulta por tecla.
  debounce = setTimeout(async () => {
    try {
      const [props, pers] = await Promise.all([
        api<{ items: Array<{ id: string; etiqueta: string; direccion: string }> }>(
          `/propiedades?q=${encodeURIComponent(q)}&porPagina=5`,
        ),
        api<{ items: Array<{ id: string; nombreCompleto: string; docNumero: string | null }> }>(
          `/personas?q=${encodeURIComponent(q)}&porPagina=5`,
        ),
      ]);

      remotos.value = [
        ...props.items.map((p) => ({
          id: `p${p.id}`,
          titulo: p.direccion,
          detalle: p.etiqueta,
          icono: 'edificio',
          seccion: 'Propiedades',
          ir: () => router.push(`/propiedades/${p.id}`),
        })),
        ...pers.items.map((p) => ({
          id: `c${p.id}`,
          titulo: p.nombreCompleto,
          detalle: p.docNumero ?? undefined,
          icono: 'personas',
          seccion: 'Personas',
          ir: () => router.push(`/personas/${p.id}`),
        })),
      ];
    } catch {
      remotos.value = [];
    }
  }, 180);
});

watch(abierta, async (v) => {
  if (v) {
    consulta.value = '';
    remotos.value = [];
    seleccion.value = 0;
    await nextTick();
    campo.value?.focus();
  }
});

function ejecutar(i: Item) {
  abierta.value = false;
  i.ir();
}

function teclas(e: KeyboardEvent) {
  if (e.key === 'Escape') return (abierta.value = false);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    seleccion.value = Math.min(seleccion.value + 1, resultados.value.length - 1);
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    seleccion.value = Math.max(seleccion.value - 1, 0);
  }
  if (e.key === 'Enter') {
    const i = resultados.value[seleccion.value];
    if (i) ejecutar(i);
  }
}

function indiceGlobal(seccion: string, pos: number): number {
  let n = 0;
  for (const [s, items] of porSeccion.value) {
    if (s === seccion) return n + pos;
    n += items.length;
  }
  return pos;
}
</script>

<template>
  <div v-if="abierta" class="velo" @click.self="abierta = false">
    <div class="paleta" role="dialog" aria-modal="true" aria-label="Buscar">
      <div class="campo">
        <UiIcon nombre="buscar" />
        <input
          ref="campo"
          v-model="consulta"
          type="text"
          placeholder="Buscar propiedades, personas o ir a…"
          @keydown="teclas"
        />
        <kbd>esc</kbd>
      </div>

      <div class="lista">
        <template v-for="[seccion, items] in porSeccion" :key="seccion">
          <p class="seccion">{{ seccion }}</p>
          <button
            v-for="(i, pos) in items"
            :key="i.id"
            type="button"
            class="item"
            :class="{ activo: indiceGlobal(seccion, pos) === seleccion }"
            @click="ejecutar(i)"
            @mouseenter="seleccion = indiceGlobal(seccion, pos)"
          >
            <UiIcon :nombre="i.icono" />
            <span class="titulo">{{ i.titulo }}</span>
            <span v-if="i.detalle" class="detalle mono">{{ i.detalle }}</span>
          </button>
        </template>

        <p v-if="!resultados.length" class="vacio">Nada coincide con “{{ consulta }}”.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.velo {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(26, 24, 21, 0.4);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
}

.paleta {
  width: min(600px, calc(100vw - 32px));
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-2);
  overflow: hidden;
}

.campo {
  display: flex;
  align-items: center;
  gap: var(--s-md);
  padding: var(--s-md) var(--s-lg);
  border-bottom: 1px solid var(--line);
  color: var(--muted);
}
.campo input {
  flex: 1;
  font: inherit;
  font-size: 15px;
  border: none;
  background: transparent;
  color: var(--ink);
}
.campo input:focus {
  outline: none;
  box-shadow: none;
}
.campo kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--muted-2);
}

.lista {
  max-height: 52vh;
  overflow-y: auto;
  padding: var(--s-sm);
}

.seccion {
  margin: var(--s-sm) var(--s-sm) var(--s-xs);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted-2);
}

.item {
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
  text-align: left;
  cursor: pointer;
}
.item.activo {
  background: var(--accent-tint);
  color: var(--accent);
}
.titulo {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detalle {
  font-size: 12px;
  color: var(--muted-2);
}
.vacio {
  padding: var(--s-xl);
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
</style>
