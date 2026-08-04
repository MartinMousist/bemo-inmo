<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha, money, periodo as fmtPeriodo } from '../dominio/formato';

/**
 * La caja del día.
 *
 * Contesta la pregunta de las siete de la tarde: "¿cuánto entró hoy y cuadra
 * con lo que hay?". Los datos estaban en `cobro` desde la etapa 4; contestarla
 * era abrir contrato por contrato.
 *
 * Los totales van **por moneda y por medio**, nunca sumados: para arquear hace
 * falta saber cuánto fue en efectivo y cuánto por transferencia. Un total único
 * no sirve para lo único que esto tiene que servir.
 */

interface Importe { moneda: string; monto: number }
interface Movimiento {
  id: string; fecha: string; monto: number; moneda: string; medio: string;
  imputacion: string; comprobante: string | null; registradoPor: string | null;
  contratoId: string; etiquetaPropiedad: string; direccion: string;
  inquilino: string | null; periodo: string;
}
interface Caja {
  desde: string; hasta: string;
  totales: Importe[];
  porMedio: Array<{ medio: string; moneda: string; monto: number; operaciones: number }>;
  movimientos: Movimiento[];
  total: number;
}

const MEDIO: Record<string, string> = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque',
  debito: 'Débito', otro: 'Otro',
};

const router = useRouter();
const d = ref<Caja | null>(null);
const cargando = ref(true);
const error = ref('');

function hoyLocal(): string {
  const x = new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(
    x.getDate(),
  ).padStart(2, '0')}`;
}

const desde = ref(hoyLocal());
const hasta = ref(hoyLocal());
const medio = ref('');

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    const p = new URLSearchParams({ desde: desde.value, hasta: hasta.value });
    if (medio.value) p.set('medio', medio.value);
    d.value = await api<Caja>(`/caja?${p}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la caja.';
  } finally {
    cargando.value = false;
  }
}

watch([desde, hasta, medio], () => void cargar());

/** Atajos: es lo que se usa, no el selector de fechas. */
function rango(dias: number) {
  const fin = new Date();
  const ini = new Date();
  ini.setDate(ini.getDate() - dias);
  hasta.value = `${fin.getFullYear()}-${String(fin.getMonth() + 1).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`;
  desde.value = `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, '0')}-${String(ini.getDate()).padStart(2, '0')}`;
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Caja"
      :bajada="cargando || !d ? '' : `${d.total} movimiento(s)`"
    >
      <template #acciones>
        <div class="segmented">
          <button type="button" :class="{ activo: desde === hasta && hasta === hoyLocal() }"
                  @click="rango(0)">Hoy</button>
          <button type="button" @click="rango(6)">7 días</button>
          <button type="button" @click="rango(29)">30 días</button>
        </div>
      </template>
    </PageHeader>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="filtros">
      <label class="campo"><span>Desde</span><input v-model="desde" type="date" /></label>
      <label class="campo"><span>Hasta</span><input v-model="hasta" type="date" /></label>
      <label class="campo"><span>Medio</span>
        <select v-model="medio">
          <option value="">Todos</option>
          <option v-for="(t, k) in MEDIO" :key="k" :value="k">{{ t }}</option>
        </select>
      </label>
    </div>

    <UiSkeleton v-if="cargando" :filas="5" :alto="64" />

    <template v-else-if="d">
      <!-- ── El arqueo ────────────────────────────────────────────────── -->
      <div v-if="d.totales.length" class="arqueo">
        <div class="total">
          <span class="et">Entró</span>
          <span v-for="t in d.totales" :key="t.moneda" class="n mono">
            {{ money(t.monto, t.moneda) }}
          </span>
        </div>

        <!-- Por medio, que es lo que se compara contra el efectivo del cajón y
             contra el extracto del banco. -->
        <ul class="medios">
          <li v-for="m in d.porMedio" :key="`${m.medio}-${m.moneda}`">
            <StatusChip :texto="MEDIO[m.medio] ?? m.medio" tono="acento" />
            <span class="mono">{{ money(m.monto, m.moneda) }}</span>
            <span class="ops">{{ m.operaciones }} op.</span>
          </li>
        </ul>
      </div>

      <UiEmpty
        v-if="!d.movimientos.length"
        titulo="No entró nada en ese período"
        detalle="Los cobros que se registren van a aparecer acá, con su medio y quién los cargó."
      />

      <div v-else class="card sin-padding">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Propiedad</th><th>Inquilino</th><th>Período</th>
                <th class="der">Monto</th><th>Medio</th><th>Comprobante</th><th>Cargó</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="m in d.movimientos"
                :key="m.id"
                tabindex="0"
                @click="router.push(`/contratos/${m.contratoId}`)"
                @keydown.enter="router.push(`/contratos/${m.contratoId}`)"
              >
                <td class="mono">{{ fecha(m.fecha) }}</td>
                <td>
                  <span class="mono cod">{{ m.etiquetaPropiedad }}</span>
                  <span class="dir">{{ m.direccion }}</span>
                </td>
                <td>{{ m.inquilino ?? '—' }}</td>
                <td class="mono">{{ fmtPeriodo(m.periodo) }}</td>
                <td class="der mono fuerte">
                  {{ money(m.monto, m.moneda) }}
                  <!-- El interés por mora se distingue del alquiler: para el
                       arqueo son la misma plata, para la liquidación no. -->
                  <span v-if="m.imputacion === 'punitorio'" class="imput">punitorio</span>
                </td>
                <td><StatusChip :texto="MEDIO[m.medio] ?? m.medio" tono="neutro" /></td>
                <td class="mono comp">{{ m.comprobante ?? '—' }}</td>
                <td class="quien">{{ m.registradoPor ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p v-if="d.total > d.movimientos.length" class="nota">
        Se muestran los {{ d.movimientos.length }} más recientes de {{ d.total }}.
        Acotá el período para verlos todos.
      </p>
    </template>
  </div>
</template>

<style scoped>
.segmented { display: inline-flex; border: 1px solid var(--line-strong); border-radius: var(--r-md); overflow: hidden; background: var(--surface); }
.segmented button { font: inherit; font-size: 13px; padding: var(--s-sm) var(--s-lg); border: none; border-right: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; }
.segmented button:last-child { border-right: none; }
.segmented button.activo { background: var(--accent-tint); color: var(--accent); font-weight: 500; }

.filtros { display: flex; gap: var(--s-lg); flex-wrap: wrap; align-items: flex-end; }
.campo { display: flex; flex-direction: column; gap: var(--s-xs); font-size: 12px; color: var(--muted); }
.campo input, .campo select {
  font: inherit; font-size: 13px;
  padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink);
}

.arqueo {
  display: flex; align-items: center; gap: var(--s-2xl); flex-wrap: wrap;
  padding: var(--s-lg);
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-lg); box-shadow: var(--sh-1);
}
.total { display: flex; flex-direction: column; gap: 2px; }
.total .et { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.total .n { font-size: 24px; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }

.medios { list-style: none; margin: 0; padding: 0; display: flex; gap: var(--s-lg); flex-wrap: wrap; }
.medios li { display: flex; align-items: center; gap: var(--s-sm); font-size: 13px; color: var(--ink-2); }
.medios .ops { font-size: 11px; color: var(--muted-2); }

.card.sin-padding { padding: 0; overflow: hidden; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 900px; }
th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); padding: var(--s-md) var(--s-lg); border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: var(--s-md) var(--s-lg); border-bottom: 1px solid var(--line); color: var(--ink-2); vertical-align: top; }
tbody tr { cursor: pointer; transition: background var(--t-micro); }
tbody tr:hover { background: var(--surface-2); }
tbody tr:last-child td { border-bottom: none; }
.der { text-align: right; }
.fuerte { color: var(--ink); }
.cod { display: block; font-size: 11px; color: var(--muted); }
.dir { color: var(--ink); }
.imput { display: block; margin-top: 2px; font-size: 10px; color: var(--warning); }
.comp, .quien { color: var(--muted); font-size: 12px; }

.nota { margin: 0; font-size: 12px; color: var(--muted); }
.alert { margin: 0; padding: var(--s-sm) var(--s-md); background: var(--danger-tint); border: 1px solid var(--danger-line); border-radius: var(--r-md); color: var(--danger); font-size: 13px; }
</style>
