<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { ETIQUETA_OPERACION, fecha, money } from '../dominio/formato';

interface Reserva {
  id: string; monto: number; moneda: string; fecha: string; venceEl: string | null;
  estado: string; persona: string; codigoPropiedad: number; calle: string;
  numero: string | null; tipoOperacion: string;
}

const items = ref<Reserva[]>([]);
const cargando = ref(true);
const error = ref('');

const TONO: Record<string, 'ok' | 'warn' | 'err' | 'neutro'> = {
  activa: 'ok', convertida: 'neutro', caida: 'err', vencida: 'err',
};
const ETIQUETA: Record<string, string> = {
  activa: 'Activa', convertida: 'Convertida', caida: 'Caída', vencida: 'Vencida',
};

async function cargar() {
  cargando.value = true; error.value = '';
  try { items.value = await api<Reserva[]>('/reservas'); }
  catch (e) { error.value = e instanceof ApiError ? e.detail : 'No se pudieron cargar las reservas.'; }
  finally { cargando.value = false; }
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Reservas" :bajada="cargando ? '' : `${items.length} registradas`" />
    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="card sin-padding">
      <UiSkeleton v-if="cargando" :filas="4" />
      <UiEmpty
        v-else-if="!items.length"
        titulo="Todavía no hay reservas"
        detalle="Una seña se toma desde la operación de la propiedad. Sólo puede haber una activa por operación."
      />
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr><th>Propiedad</th><th>Operación</th><th>Persona</th><th class="der">Monto</th><th>Fecha</th><th>Vence</th><th>Estado</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in items" :key="r.id">
              <td class="mono cod">PROP-{{ String(r.codigoPropiedad).padStart(4, '0') }}
                <span class="dir">{{ r.calle }} {{ r.numero }}</span>
              </td>
              <td>{{ ETIQUETA_OPERACION[r.tipoOperacion] ?? r.tipoOperacion }}</td>
              <td>{{ r.persona }}</td>
              <td class="der mono fuerte">{{ money(r.monto, r.moneda) }}</td>
              <td class="mono">{{ fecha(r.fecha) }}</td>
              <td class="mono">{{ fecha(r.venceEl) }}</td>
              <td><StatusChip :texto="ETIQUETA[r.estado] ?? r.estado" :tono="TONO[r.estado] ?? 'neutro'" /></td>
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
th {
  text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--muted); padding: var(--s-md) var(--s-lg);
  border-bottom: 1px solid var(--line); white-space: nowrap;
}
td { padding: var(--s-md) var(--s-lg); border-bottom: 1px solid var(--line); color: var(--ink-2); }
tbody tr:last-child td { border-bottom: none; }
.der { text-align: right; }
.fuerte { color: var(--ink); }
.cod { color: var(--muted); white-space: nowrap; }
.dir { display: block; font-family: var(--font-ui); color: var(--ink-2); }
.alert {
  margin: 0; padding: var(--s-sm) var(--s-md); background: var(--danger-tint);
  border: 1px solid var(--danger-line); border-radius: var(--r-md); color: var(--danger); font-size: 13px;
}
</style>
