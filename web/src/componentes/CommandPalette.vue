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
  { id: 'n0', titulo: 'Inicio', icono: 'monitor', seccion: 'Ir a', ir: () => router.push('/inicio') },
  { id: 'n1', titulo: 'Propiedades', icono: 'edificio', seccion: 'Ir a', ir: () => router.push('/propiedades') },
  { id: 'n2', titulo: 'Personas', icono: 'personas', seccion: 'Ir a', ir: () => router.push('/personas') },
  // Las tres pantallas por rol. Una pantalla que no está en ⌘K existe a medias:
  // quien usa la paleta no baja a buscarla en la barra lateral.
  { id: 'n12', titulo: 'Propietarios', icono: 'edificio', seccion: 'Ir a', ir: () => router.push('/propietarios') },
  { id: 'n13', titulo: 'Inquilinos', icono: 'documento', seccion: 'Ir a', ir: () => router.push('/inquilinos') },
  { id: 'n14', titulo: 'Garantes', icono: 'equipo', seccion: 'Ir a', ir: () => router.push('/garantes') },
  { id: 'n3', titulo: 'Leads', icono: 'embudo', seccion: 'Ir a', ir: () => router.push('/leads') },
  { id: 'n4', titulo: 'Reservas', icono: 'sena', seccion: 'Ir a', ir: () => router.push('/reservas') },
  { id: 'n5', titulo: 'Equipo', icono: 'equipo', seccion: 'Ir a', ir: () => router.push('/equipo') },
  { id: 'n6', titulo: 'Contratos', icono: 'documento', seccion: 'Ir a', ir: () => router.push('/contratos') },
  { id: 'n7', titulo: 'Liquidaciones', icono: 'moneda', seccion: 'Ir a', ir: () => router.push('/liquidaciones') },
  { id: 'n8', titulo: 'Caja', icono: 'sena', seccion: 'Ir a', ir: () => router.push('/caja') },
  { id: 'n9', titulo: 'Vencimientos', icono: 'calendario', seccion: 'Ir a', ir: () => router.push('/vencimientos') },
  { id: 'n10', titulo: 'Movimientos', icono: 'grafico', seccion: 'Ir a', ir: () => router.push('/movimientos') },
  { id: 'n11', titulo: 'Índices', icono: 'grafico', seccion: 'Ir a', ir: () => router.push('/indices') },
  { id: 'a1', titulo: 'Nueva propiedad', icono: 'mas', seccion: 'Crear', ir: () => router.push('/propiedades/nueva') },
  { id: 'a2', titulo: 'Nueva persona', icono: 'mas', seccion: 'Crear', ir: () => router.push('/personas/nueva') },
  { id: 'a3', titulo: 'Nuevo lead', icono: 'mas', seccion: 'Crear', ir: () => router.push('/leads/nueva') },
  { id: 'a4', titulo: 'Nuevo contrato', icono: 'mas', seccion: 'Crear', ir: () => router.push('/contratos/nuevo') },
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
      <div class="paleta-input">
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

      <div class="paleta-lista">
        <template v-for="[seccion, items] in porSeccion" :key="seccion">
          <p class="paleta-grupo">{{ seccion }}</p>
          <button
            v-for="(i, pos) in items"
            :key="i.id"
            type="button"
            class="paleta-item"
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
/* El velo, la caja, el buscador, los grupos y los ítems son capa familia
   (`.velo`, `.paleta`, `.paleta-input`, `.paleta-grupo`, `.paleta-item`).
   Acá queda sólo lo propio de la paleta. */

/* Más alta que un modal y anclada arriba: se abre con ⌘K mientras se escribe,
   y el ojo ya está en el borde superior. */
.paleta-lista { max-height: 52vh; }

.vacio {
  padding: var(--s-xl);
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
</style>
