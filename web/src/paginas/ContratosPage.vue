<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError, descargar } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha, money, proximidad } from '../dominio/formato';

interface Contrato {
  id: string;
  propiedad: { etiqueta: string; direccion: string };
  fechaFin: string;
  montoVigente: number;
  moneda: string;
  indice: string;
  periodicidadMeses: number;
  estado: string;
  administrado: boolean;
  locatarios: Array<{ nombre: string }>;
  proximoAjuste: string | null;
}

const ETIQUETA_INDICE: Record<string, string> = {
  ipc: 'IPC', icl: 'ICL', uva: 'UVA', icp: 'Casa Propia',
  porcentaje_fijo: '% fijo', ninguno: 'Sin ajuste',
};
const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Borrador', por_iniciar: 'Por iniciar', vigente: 'Vigente',
  vencido: 'Vencido', rescindido: 'Rescindido', renovado: 'Renovado',
};

const router = useRouter();
const items = ref<Contrato[]>([]);
const total = ref(0);
const cargando = ref(true);
const error = ref('');

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const r = await api<{ items: Contrato[]; total: number }>('/contratos?porPagina=50');
    items.value = r.items; total.value = r.total;
  } catch (e) {
    error.value = e instanceof ApiError ? e.detail : 'No se pudieron cargar los contratos.';
  } finally { cargando.value = false; }
}

async function exportar() {
  error.value = '';
  try { await descargar('/exportar/contratos.csv'); }
  catch (e) { error.value = e instanceof ApiError ? e.detail : 'No se pudo exportar.'; }
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Contratos" :bajada="cargando ? '' : `${total} de alquiler`">
      <template #acciones>
        <button class="btn secondary" type="button" @click="exportar">Exportar</button>
        <RouterLink class="btn" to="/contratos/nuevo">Nuevo contrato</RouterLink>
      </template>
    </PageHeader>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="card sin-padding">
      <UiSkeleton v-if="cargando" :filas="4" />
      <UiEmpty v-else-if="!items.length" titulo="Todavía no hay contratos"
        detalle="Cargá el primero y el sistema se ocupa de los aumentos, los vencimientos y la liquidación al propietario.">
        <RouterLink class="btn" to="/contratos/nuevo">Cargar el primero</RouterLink>
      </UiEmpty>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Propiedad</th><th>Inquilino</th><th class="der">Alquiler</th>
              <th>Ajuste</th><th>Próximo aumento</th><th>Vence</th><th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in items" :key="c.id" tabindex="0"
                @click="router.push(`/contratos/${c.id}`)"
                @keydown.enter="router.push(`/contratos/${c.id}`)">
              <td>
                <span class="mono cod">{{ c.propiedad.etiqueta }}</span>
                <span class="dir">{{ c.propiedad.direccion }}</span>
              </td>
              <td>{{ c.locatarios.map((l) => l.nombre).join(', ') || '—' }}</td>
              <td class="der mono fuerte">{{ money(c.montoVigente, c.moneda) }}</td>
              <td>
                <StatusChip :texto="ETIQUETA_INDICE[c.indice] ?? c.indice" tono="acento" />
                <span v-if="c.indice !== 'ninguno'" class="cada">c/{{ c.periodicidadMeses }}m</span>
              </td>
              <td class="mono">{{ c.proximoAjuste ? fecha(c.proximoAjuste) : '—' }}</td>
              <td>
                <StatusChip :texto="proximidad(c.fechaFin).texto"
                  :tono="proximidad(c.fechaFin).tono === 'neutro' ? 'neutro' : proximidad(c.fechaFin).tono === 'warn' ? 'warn' : 'err'" />
              </td>
              <td>
                <StatusChip :texto="ETIQUETA_ESTADO[c.estado] ?? c.estado"
                  :tono="c.estado === 'vigente' ? 'ok' : 'neutro'" />
                <span v-if="!c.administrado" class="inter" title="Sólo intermediación: no genera cuotas">
                  intermediación
                </span>
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
th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); padding: var(--s-md) var(--s-lg); border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: var(--s-md) var(--s-lg); border-bottom: 1px solid var(--line); color: var(--ink-2); }
tbody tr { cursor: pointer; transition: background var(--t-micro); }
tbody tr:hover { background: var(--surface-2); }
tbody tr:last-child td { border-bottom: none; }
.der { text-align: right; }
.fuerte { color: var(--ink); }
.cod { display: block; font-size: 11px; color: var(--muted); }
.dir { color: var(--ink); }
.cada { margin-left: var(--s-xs); font-size: 11px; color: var(--muted-2); }
.inter { display: block; margin-top: 2px; font-size: 10px; color: var(--muted-2); }
.alert { margin: 0; padding: var(--s-sm) var(--s-md); background: var(--danger-tint); border: 1px solid var(--danger-line); border-radius: var(--r-md); color: var(--danger); font-size: 13px; }
</style>
