<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError, descargar } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import PanelMapas from '../componentes/PanelMapas.vue';
import SearchInput from '../componentes/SearchInput.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import {
  ETIQUETA_ESTADO_OP,
  ETIQUETA_OPERACION,
  ETIQUETA_TIPO,
  moneyCorto,
  numero,
} from '../dominio/formato';

interface Operacion {
  id: string;
  tipo: string;
  precio: number | null;
  moneda: string;
  estado: string;
}

interface Propiedad {
  id: string;
  etiqueta: string;
  direccion: string;
  tipo: string;
  ambientes: number | null;
  supTotal: number | null;
  ubicacionConocida: boolean;
  operaciones: Operacion[];
}

const router = useRouter();
const items = ref<Propiedad[]>([]);
const total = ref(0);
const pagina = ref(1);
const paginas = ref(1);
const q = ref('');
const filtroOperacion = ref('');
const cargando = ref(true);
const error = ref('');

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({
      pagina: String(pagina.value),
      porPagina: '25',
    });
    if (q.value.trim()) params.set('q', q.value.trim());
    if (filtroOperacion.value) params.set('operacion', filtroOperacion.value);

    const r = await api<{ items: Propiedad[]; total: number; paginas: number }>(
      `/propiedades?${params}`,
    );
    items.value = r.items;
    total.value = r.total;
    paginas.value = r.paginas;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar las propiedades.';
  } finally {
    cargando.value = false;
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
watch([q, filtroOperacion], () => {
  clearTimeout(debounce);
  pagina.value = 1;
  debounce = setTimeout(cargar, 220);
});
watch(pagina, () => void cargar());

function tono(estado: string) {
  if (estado === 'disponible') return 'ok' as const;
  if (estado === 'reservada') return 'warn' as const;
  if (estado === 'cerrada' || estado === 'suspendida') return 'err' as const;
  return 'neutro' as const;
}

async function exportar() {
  error.value = '';
  try { await descargar('/exportar/propiedades.csv'); }
  catch (e) { error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo exportar.'; }
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Propiedades"
      :bajada="cargando ? '' : `${total} en cartera`"
    >
      <template #acciones>
        <button class="btn secondary" type="button" @click="exportar">Exportar</button>
        <RouterLink class="btn" to="/propiedades/nueva">Nueva propiedad</RouterLink>
      </template>
    </PageHeader>

    <!-- Sólo aparece si hay algo que hacer con los mapas: falta la key, la key
         no responde, o quedaron propiedades sin ubicar. -->
    <PanelMapas @sincronizado="cargar" />

    <div class="filtros">
      <SearchInput v-model="q" placeholder="Dirección, localidad o código…" />
      <div class="segmented">
        <button
          v-for="op in [
            { v: '', t: 'Todas' },
            { v: 'venta', t: 'Venta' },
            { v: 'alquiler', t: 'Alquiler' },
          ]"
          :key="op.v"
          type="button"
          :class="{ activo: filtroOperacion === op.v }"
          @click="filtroOperacion = op.v"
        >
          {{ op.t }}
        </button>
      </div>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="card sin-padding">
      <UiSkeleton v-if="cargando" :filas="5" />

      <UiEmpty
        v-else-if="!items.length"
        :titulo="q || filtroOperacion ? 'Ninguna propiedad coincide' : 'Todavía no hay propiedades'"
        :detalle="
          q || filtroOperacion
            ? 'Probá con otra búsqueda o quitá los filtros.'
            : 'Cargá la primera y quedará disponible para publicar y para asociar a una operación.'
        "
      >
        <RouterLink v-if="!q && !filtroOperacion" class="btn" to="/propiedades/nueva">
          Cargar la primera
        </RouterLink>
        <button v-else class="btn secondary" type="button" @click="q = ''; filtroOperacion = ''">
          Quitar filtros
        </button>
      </UiEmpty>

      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Dirección</th>
              <th>Tipo</th>
              <th class="der">Amb.</th>
              <th class="der">m²</th>
              <th>Operaciones</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in items"
              :key="p.id"
              tabindex="0"
              @click="router.push(`/propiedades/${p.id}`)"
              @keydown.enter="router.push(`/propiedades/${p.id}`)"
            >
              <td class="mono cod">{{ p.etiqueta }}</td>
              <td>
                <span class="dir">{{ p.direccion }}</span>
                <span v-if="!p.ubicacionConocida" class="sin-ubi" title="Sin ubicación en el mapa">
                  sin ubicar
                </span>
              </td>
              <td>{{ ETIQUETA_TIPO[p.tipo] ?? p.tipo }}</td>
              <td class="der mono">{{ numero(p.ambientes) }}</td>
              <td class="der mono">{{ numero(p.supTotal) }}</td>
              <td>
                <div class="ops">
                  <span v-for="o in p.operaciones" :key="o.id" class="op">
                    <StatusChip :texto="ETIQUETA_OPERACION[o.tipo] ?? o.tipo" tono="acento" />
                    <span class="mono precio">{{ moneyCorto(o.precio, o.moneda) }}</span>
                    <StatusChip :texto="ETIQUETA_ESTADO_OP[o.estado] ?? o.estado" :tono="tono(o.estado)" />
                  </span>
                  <span v-if="!p.operaciones.length" class="muted">Sin operación</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="paginas > 1" class="pager">
      <button class="btn secondary sm" :disabled="pagina === 1" @click="pagina--">Anterior</button>
      <span class="mono">{{ pagina }} / {{ paginas }}</span>
      <button class="btn secondary sm" :disabled="pagina === paginas" @click="pagina++">
        Siguiente
      </button>
    </div>
  </div>
</template>

<style scoped>
.filtros {
  display: flex;
  gap: var(--s-md);
  flex-wrap: wrap;
}
.filtros > :first-child { flex: 1; min-width: 220px; }

.segmented {
  display: inline-flex;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--surface);
}
.segmented button {
  font: inherit;
  font-size: 13px;
  padding: var(--s-sm) var(--s-lg);
  border: none;
  border-right: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.segmented button:last-child { border-right: none; }
.segmented button.activo {
  background: var(--accent-tint);
  color: var(--accent);
  font-weight: 500;
}

.card.sin-padding { padding: 0; overflow: hidden; }
.table-wrap { overflow-x: auto; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  background: var(--surface);
  padding: var(--s-md) var(--s-lg);
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
td {
  padding: var(--s-md) var(--s-lg);
  border-bottom: 1px solid var(--line);
  color: var(--ink-2);
  vertical-align: middle;
}
tbody tr { cursor: pointer; transition: background var(--t-micro); }
tbody tr:hover { background: var(--surface-2); }
tbody tr:last-child td { border-bottom: none; }
.der { text-align: right; }
.cod { color: var(--muted); white-space: nowrap; }
.dir { color: var(--ink); }
.sin-ubi {
  margin-left: var(--s-sm);
  font-size: 11px;
  color: var(--warning);
}
.ops { display: flex; flex-direction: column; gap: var(--s-xs); }
.op { display: inline-flex; align-items: center; gap: var(--s-sm); }
.precio { font-size: 12px; color: var(--ink); }
.muted { color: var(--muted-2); font-size: 12px; }

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-lg);
  font-size: 13px;
  color: var(--muted);
}
.btn.sm { padding: 4px var(--s-md); font-size: 12px; }
.btn:disabled { opacity: 0.5; cursor: default; }

.alert {
  margin: 0;
  padding: var(--s-sm) var(--s-md);
  background: var(--danger-tint);
  border: 1px solid var(--danger-line);
  border-radius: var(--r-md);
  color: var(--danger);
  font-size: 13px;
}
</style>
