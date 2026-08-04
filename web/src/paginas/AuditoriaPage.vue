<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import SearchInput from '../componentes/SearchInput.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiPager from '../componentes/UiPager.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fechaHora, money } from '../dominio/formato';
import { consulta, type Pagina } from '../dominio/pagina';

/**
 * Quién tocó la plata.
 *
 * La pregunta que contesta no es "¿quién cerró esta liquidación?" —eso se ve en
 * la ficha— sino **"¿qué pasó el martes?"**. Por eso es una lista cronológica y
 * no un campo escondido en cada pantalla.
 */

interface Asiento {
  id: string;
  accion: string;
  usuario: { id: string | null; nombre: string | null };
  entidadTipo: string;
  entidadId: string;
  monto: number | null;
  moneda: string | null;
  detalle: Record<string, unknown>;
  ip: string | null;
  cuando: string;
}

const ACCION: Record<string, string> = {
  cobro_registrado: 'Cobro registrado',
  punitorio_condonado: 'Punitorio condonado',
  ajuste_confirmado: 'Aumento confirmado',
  liquidacion_cerrada: 'Liquidación cerrada',
  liquidacion_pagada: 'Liquidación pagada',
  gasto_agregado: 'Gasto agregado',
  comision_cobrada: 'Comisión cobrada',
  deposito_devuelto: 'Depósito devuelto',
  contrato_renovado: 'Contrato renovado',
};

/** Rojo para lo que RESIGNA plata; el resto es movimiento normal. */
const TONO: Record<string, 'ok' | 'warn' | 'err' | 'acento' | 'neutro'> = {
  cobro_registrado: 'ok',
  punitorio_condonado: 'warn',
  ajuste_confirmado: 'acento',
  liquidacion_cerrada: 'acento',
  liquidacion_pagada: 'ok',
  gasto_agregado: 'warn',
  comision_cobrada: 'ok',
  deposito_devuelto: 'warn',
  contrato_renovado: 'neutro',
};

const POR_PAGINA = 50;

const items = ref<Asiento[]>([]);
const total = ref(0);
const paginas = ref(1);
const pagina = ref(1);
const q = ref('');
const accion = ref('');
const desde = ref('');
const hasta = ref('');
const cargando = ref(true);
const error = ref('');

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    const r = await api<Pagina<Asiento>>(
      `/auditoria?${consulta(
        { pagina: pagina.value, porPagina: POR_PAGINA },
        { q: q.value.trim(), accion: accion.value, desde: desde.value, hasta: hasta.value },
      )}`,
    );
    items.value = r.items;
    total.value = r.total;
    paginas.value = r.paginas;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la auditoría.';
  } finally {
    cargando.value = false;
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
watch([q, accion, desde, hasta], () => {
  clearTimeout(debounce);
  pagina.value = 1;
  debounce = setTimeout(cargar, 220);
});
watch(pagina, () => void cargar());

/**
 * Una línea legible del detalle. Se eligen a mano los campos que significan
 * algo para una persona: volcar el JSON entero sería mostrar ruido y esconder
 * el dato.
 */
function contexto(a: Asiento): string {
  const d = a.detalle;
  const partes: string[] = [];

  if (typeof d.propietario === 'string') partes.push(d.propietario);
  if (typeof d.imputacion === 'string' && d.imputacion !== 'alquiler') {
    partes.push(`imputado a ${d.imputacion}`);
  }
  if (typeof d.medio === 'string') partes.push(d.medio);
  if (typeof d.motivo === 'string') partes.push(`«${d.motivo}»`);
  if (typeof d.concepto === 'string') partes.push(d.concepto);
  if (typeof d.montoAnterior === 'number' && a.moneda) {
    partes.push(`antes ${money(d.montoAnterior, a.moneda)}`);
  }
  if (typeof d.totalDescuentos === 'number' && d.totalDescuentos > 0 && a.moneda) {
    partes.push(`descuentos ${money(d.totalDescuentos, a.moneda)}`);
  }

  return partes.join(' · ');
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Movimientos"
      bajada="Quién tocó la plata, cuándo y por cuánto. No se edita ni se borra."
    />

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="filtros">
      <SearchInput v-model="q" placeholder="Quién lo hizo, o el detalle…" />
      <select v-model="accion" aria-label="Tipo de movimiento">
        <option value="">Todos los movimientos</option>
        <option v-for="(t, k) in ACCION" :key="k" :value="k">{{ t }}</option>
      </select>
      <label class="campo"><span>Desde</span><input v-model="desde" type="date" /></label>
      <label class="campo"><span>Hasta</span><input v-model="hasta" type="date" /></label>
      <button
        v-if="q || accion || desde || hasta"
        class="btn secondary sm"
        type="button"
        @click="q = ''; accion = ''; desde = ''; hasta = ''"
      >
        Limpiar
      </button>
    </div>

    <UiSkeleton v-if="cargando" :filas="6" :alto="52" />

    <UiEmpty
      v-else-if="!items.length"
      :titulo="q || accion || desde || hasta ? 'Nada coincide' : 'Todavía no hay movimientos'"
      detalle="Cada cobro, aumento confirmado, liquidación cerrada y depósito devuelto deja acá su registro."
    />

    <div v-else class="card sin-padding">
      <ul class="lista">
        <li v-for="a in items" :key="a.id">
          <span class="mono cuando">{{ fechaHora(a.cuando) }}</span>
          <StatusChip :texto="ACCION[a.accion] ?? a.accion" :tono="TONO[a.accion] ?? 'neutro'" />
          <div class="que">
            <span class="quien">{{ a.usuario.nombre ?? 'Usuario dado de baja' }}</span>
            <span v-if="contexto(a)" class="ctx">{{ contexto(a) }}</span>
          </div>
          <span v-if="a.monto !== null && a.moneda" class="mono monto">
            {{ money(a.monto, a.moneda) }}
          </span>
          <span v-else class="monto" />
        </li>
      </ul>
    </div>

    <UiPager
      v-if="!cargando"
      v-model:pagina="pagina"
      :paginas="paginas"
      :total="total"
      :por-pagina="POR_PAGINA"
      sustantivo="movimientos"
    />
  </div>
</template>

<style scoped>
.filtros { display: flex; gap: var(--s-md); flex-wrap: wrap; align-items: flex-end; }
.filtros > :first-child { flex: 1; min-width: 220px; }
.filtros select, .filtros input {
  font: inherit; font-size: 13px;
  padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink);
}
.campo { display: flex; flex-direction: column; gap: var(--s-xs); font-size: 12px; color: var(--muted); }

.card.sin-padding { padding: 0; overflow: hidden; }
.lista { list-style: none; margin: 0; padding: 0; }
.lista li {
  display: grid;
  grid-template-columns: 140px auto 1fr auto;
  align-items: center;
  gap: var(--s-md);
  padding: var(--s-md) var(--s-lg);
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.lista li:last-child { border-bottom: none; }
.cuando { font-size: 12px; color: var(--muted); white-space: nowrap; }
.que { display: flex; flex-direction: column; min-width: 0; }
.quien { color: var(--ink); }
.ctx { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
.monto { text-align: right; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }

.alert { margin: 0; padding: var(--s-sm) var(--s-md); background: var(--danger-tint); border: 1px solid var(--danger-line); border-radius: var(--r-md); color: var(--danger); font-size: 13px; }

@media (max-width: 760px) {
  .lista li { grid-template-columns: 1fr auto; row-gap: var(--s-xs); }
  .cuando { grid-column: 1 / -1; }
}
</style>
