<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha, money } from '../dominio/formato';

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

const router = useRouter();
const items = ref<Venta[]>([]);
const cargando = ref(true);
const error = ref('');

async function cargar() {
  cargando.value = true; error.value = '';
  try { items.value = await api<Venta[]>('/ventas'); }
  catch (e) { error.value = e instanceof ApiError ? e.detail : 'No se pudieron cargar las ventas.'; }
  finally { cargando.value = false; }
}
onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Ventas" :bajada="cargando ? '' : `${items.length} operaciones`" />
    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="card sin-padding">
      <UiSkeleton v-if="cargando" :filas="4" />
      <UiEmpty v-else-if="!items.length" titulo="Todavía no hay ventas"
        detalle="Una venta se abre desde la operación de la propiedad, con el precio de cierre. Después se reparte la comisión en sus tres niveles." />
      <div v-else class="table-wrap">
        <table>
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
  </div>
</template>

<style scoped>
.card.sin-padding { padding: 0; overflow: hidden; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); padding: var(--s-md) var(--s-lg); border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: var(--s-md) var(--s-lg); border-bottom: 1px solid var(--line); color: var(--ink-2); }
tbody tr { cursor: pointer; transition: background var(--t-micro); }
tbody tr:hover { background: var(--surface-2); }
tbody tr:last-child td { border-bottom: none; }
.der { text-align: right; }
.fuerte { color: var(--ink); }
.cod { display: block; font-size: 11px; color: var(--muted); }
.dir { color: var(--ink); }
.cuando { display: block; margin-top: 2px; font-size: 11px; color: var(--muted-2); }
.alert { margin: 0; padding: var(--s-sm) var(--s-md); background: var(--danger-tint); border: 1px solid var(--danger-line); border-radius: var(--r-md); color: var(--danger); font-size: 13px; }
</style>
