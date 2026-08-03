<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { money, periodo as fmtPeriodo } from '../dominio/formato';

interface Linea { concepto: string; tipo: string; signo: 1 | -1; monto: number }
interface Liquidacion {
  id: string; propietario: { id: string; nombre: string }; periodo: string;
  totalBruto: number; totalHonorarios: number; totalGastos: number; totalNeto: number;
  moneda: string; estado: string; lineas: Linea[];
}

const items = ref<Liquidacion[]>([]);
const mes = ref(new Date().toISOString().slice(0, 7));
const cargando = ref(true);
const error = ref('');
const abierta = ref<string | null>(null);

const ETIQUETA: Record<string, string> = { borrador: 'Borrador', cerrada: 'Cerrada', pagada: 'Pagada' };

async function cargar() {
  cargando.value = true; error.value = '';
  try { items.value = await api<Liquidacion[]>(`/liquidaciones?periodo=${mes.value}-01`); }
  catch (e) { error.value = e instanceof ApiError ? e.detail : 'No se pudieron cargar.'; }
  finally { cargando.value = false; }
}

async function generar() {
  error.value = '';
  try {
    await api('/liquidaciones/generar', {
      method: 'POST', body: JSON.stringify({ periodo: `${mes.value}-01` }),
    });
    await cargar();
  } catch (e) { error.value = e instanceof ApiError ? e.detail : 'No se pudo generar.'; }
}

async function cerrar(id: string) {
  error.value = '';
  try { await api(`/liquidaciones/${id}/cerrar`, { method: 'POST' }); await cargar(); }
  catch (e) { error.value = e instanceof ApiError ? e.detail : 'No se pudo cerrar.'; }
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Liquidaciones"
      bajada="Se liquida lo COBRADO, no lo facturado. En condominio, cada propietario recibe la suya.">
      <template #acciones>
        <input v-model="mes" type="month" class="mes" @change="cargar" />
        <button class="btn" type="button" @click="generar">Generar</button>
      </template>
    </PageHeader>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <UiSkeleton v-if="cargando" :filas="3" :alto="72" />

    <UiEmpty v-else-if="!items.length" :titulo="`Sin liquidaciones para ${fmtPeriodo(mes + '-01')}`"
      detalle="Se arman con los cobros del período que todavía no fueron rendidos. Registrá los cobros y generá." >
      <button class="btn" type="button" @click="generar">Generar el período</button>
    </UiEmpty>

    <article v-for="l in items" v-else :key="l.id" class="card liq">
      <header @click="abierta = abierta === l.id ? null : l.id">
        <div>
          <p class="quien">{{ l.propietario.nombre }}</p>
          <p class="cuando mono">{{ fmtPeriodo(l.periodo) }}</p>
        </div>
        <div class="totales">
          <div><span class="et">Bruto</span><span class="mono">{{ money(l.totalBruto, l.moneda) }}</span></div>
          <div><span class="et">Honorarios</span><span class="mono neg">− {{ money(l.totalHonorarios, l.moneda) }}</span></div>
          <div v-if="l.totalGastos"><span class="et">Gastos</span><span class="mono neg">− {{ money(l.totalGastos, l.moneda) }}</span></div>
          <div class="neto"><span class="et">Neto</span><span class="mono">{{ money(l.totalNeto, l.moneda) }}</span></div>
        </div>
        <StatusChip :texto="ETIQUETA[l.estado] ?? l.estado" :tono="l.estado === 'borrador' ? 'warn' : 'ok'" />
      </header>

      <div v-if="abierta === l.id" class="detalle">
        <table>
          <tbody>
            <tr v-for="(li, i) in l.lineas" :key="i">
              <td>{{ li.concepto }}</td>
              <td class="der mono" :class="{ neg: li.signo === -1 }">
                {{ li.signo === -1 ? '−' : '' }} {{ money(li.monto, l.moneda) }}
              </td>
            </tr>
          </tbody>
        </table>
        <div class="acciones">
          <button v-if="l.estado === 'borrador'" class="btn sm" type="button" @click="cerrar(l.id)">
            Cerrar liquidación
          </button>
          <span v-else class="nota">Cerrada: los números ya no se modifican.</span>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.mes { font: inherit; padding: var(--s-sm) var(--s-md); border: 1px solid var(--line-strong); border-radius: var(--r-md); background: var(--surface); color: var(--ink); }
.liq { padding: 0; overflow: hidden; }
.liq header { display: flex; align-items: center; gap: var(--s-xl); padding: var(--s-lg); cursor: pointer; flex-wrap: wrap; }
.liq header:hover { background: var(--surface-2); }
.quien { margin: 0; font-weight: 500; color: var(--ink); }
.cuando { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
.totales { display: flex; gap: var(--s-xl); margin-left: auto; flex-wrap: wrap; }
.totales > div { display: flex; flex-direction: column; align-items: flex-end; }
.et { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-2); }
.totales .mono { font-size: 13px; color: var(--ink-2); }
.neto .mono { font-size: 16px; color: var(--ink); font-weight: 500; }
.neg { color: var(--danger); }
.detalle { border-top: 1px solid var(--line); background: var(--surface-2); padding: var(--s-lg); }
.detalle table { width: 100%; border-collapse: collapse; font-size: 13px; }
.detalle td { padding: var(--s-xs) 0; color: var(--ink-2); }
.der { text-align: right; }
.acciones { margin-top: var(--s-md); }
.btn.sm { padding: 4px var(--s-md); font-size: 12px; }
.nota { font-size: 12px; color: var(--muted-2); }
.alert { margin: 0; padding: var(--s-sm) var(--s-md); background: var(--danger-tint); border: 1px solid var(--danger-line); border-radius: var(--r-md); color: var(--danger); font-size: 13px; }
</style>
