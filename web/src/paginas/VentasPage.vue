<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import SearchInput from '../componentes/SearchInput.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiPager from '../componentes/UiPager.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha, money } from '../dominio/formato';
import { consulta, type Pagina } from '../dominio/pagina';

interface Venta {
  id: string;
  propiedad: { etiqueta: string; direccion: string };
  comprador: { nombre: string } | null;
  precioCierre: number; moneda: string; estado: string;
  fechaBoleto: string | null; fechaEscritura: string | null;
  totales: { operacion: number; externas: number; agentes: number; casa: number };
}

const ETIQUETA: Record<string, string> = {
  en_curso: 'En curso', boleto: 'Con boleto', escriturada: 'Escriturada', caida: 'Caída',
};
const TONO: Record<string, 'neutro' | 'warn' | 'ok' | 'err'> = {
  en_curso: 'warn', boleto: 'warn', escriturada: 'ok', caida: 'err',
};

const POR_PAGINA = 25;

const router = useRouter();
const items = ref<Venta[]>([]);
const total = ref(0);
const paginas = ref(1);
const pagina = ref(1);
const q = ref('');
const filtroEstado = ref('');
const cargando = ref(true);
const error = ref('');

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const r = await api<Pagina<Venta>>(
      `/ventas?${consulta(
        { pagina: pagina.value, porPagina: POR_PAGINA },
        { q: q.value.trim(), estado: filtroEstado.value },
      )}`,
    );
    items.value = r.items;
    total.value = r.total;
    paginas.value = r.paginas;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar las ventas.';
  } finally { cargando.value = false; }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
watch([q, filtroEstado], () => {
  clearTimeout(debounce);
  pagina.value = 1;
  debounce = setTimeout(cargar, 220);
});
watch(pagina, () => void cargar());

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Ventas" :bajada="cargando ? '' : `${total} operaciones`" />
    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="filtros">
      <SearchInput v-model="q" placeholder="Dirección, código o comprador…" />
      <div class="segmented">
        <button type="button" :class="{ activo: filtroEstado === '' }" @click="filtroEstado = ''">
          Todas
        </button>
        <button
          v-for="(etiqueta, clave) in ETIQUETA"
          :key="clave"
          type="button"
          :class="{ activo: filtroEstado === clave }"
          @click="filtroEstado = clave"
        >
          {{ etiqueta }}
        </button>
      </div>
    </div>

    <div class="card sin-padding">
      <UiSkeleton v-if="cargando" :filas="4" />
      <UiEmpty
        v-else-if="!items.length && (q || filtroEstado)"
        titulo="Ninguna venta coincide"
        detalle="Probá con otro texto o sacá el filtro de estado."
      />
      <UiEmpty v-else-if="!items.length" titulo="Todavía no hay ventas"
        detalle="Una venta se abre desde la operación de la propiedad, con el precio de cierre. Después se reparte la comisión en sus tres niveles." />
      <div v-else class="table-wrap">
        <table class="table-clicable">
          <thead>
            <tr><th>Propiedad</th><th>Comprador</th><th class="der">Cierre</th>
                <th class="der">Comisión</th><th class="der">A la casa</th><th>Estado</th></tr>
          </thead>
          <tbody>
            <tr v-for="v in items" :key="v.id" tabindex="0"
                @click="router.push(`/ventas/${v.id}`)"
                @keydown.enter="router.push(`/ventas/${v.id}`)">
              <td>
                <span class="mono cod">{{ v.propiedad.etiqueta }}</span>
                <span class="dir">{{ v.propiedad.direccion }}</span>
              </td>
              <td>{{ v.comprador?.nombre ?? '—' }}</td>
              <td class="der mono fuerte">{{ money(v.precioCierre, v.moneda) }}</td>
              <td class="der mono">{{ money(v.totales.operacion, v.moneda) }}</td>
              <td class="der mono">{{ money(v.totales.casa, v.moneda) }}</td>
              <td>
                <StatusChip :texto="ETIQUETA[v.estado] ?? v.estado" :tono="TONO[v.estado] ?? 'neutro'" />
                <span v-if="v.fechaEscritura" class="cuando">{{ fecha(v.fechaEscritura) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <UiPager
      v-if="!cargando"
      v-model:pagina="pagina"
      :paginas="paginas"
      :total="total"
      :por-pagina="POR_PAGINA"
      sustantivo="ventas"
    />
  </div>
</template>

<style scoped>

.dir { color: var(--ink); }
.cuando { display: block; margin-top: 2px; font-size: 11px; color: var(--muted-2); }
</style>
