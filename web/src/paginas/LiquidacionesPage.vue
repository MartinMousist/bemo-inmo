<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError, descargar } from '../api/cliente';
import { useUi } from '../stores/ui';
import PageHeader from '../componentes/PageHeader.vue';
import SearchInput from '../componentes/SearchInput.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiPager from '../componentes/UiPager.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { money, periodo as fmtPeriodo, plural } from '../dominio/formato';
import { consulta, type Pagina } from '../dominio/pagina';

interface Linea { concepto: string; tipo: string; signo: 1 | -1; monto: number }
interface Liquidacion {
  id: string; propietario: { id: string; nombre: string }; periodo: string;
  totalBruto: number; totalHonorarios: number; totalGastos: number; totalNeto: number;
  moneda: string; estado: string; lineas: Linea[];
}

const POR_PAGINA = 25;

const ui = useUi();
/**
 * Cuánto sale este mes, por moneda.
 *
 * ── Por qué faltaba ──
 *
 * La pantalla contestaba «quién cobra cuánto» y no «cuánto tengo que pagar».
 * Ese segundo número es el que hay que tener antes de sentarse a transferir, y
 * había que sumarlo a mano de la pantalla — con tres propietarios se puede, con
 * treinta no.
 *
 * **Por moneda y no en un solo total**: sumar pesos con dólares da un número
 * que no es plata de nada.
 *
 * Suma lo que está EN PANTALLA, con los filtros aplicados. Si alguien filtró
 * por «Borrador», el total es el de los borradores, que es justo lo que quiso
 * preguntar. Por eso el rótulo dice cuántas son.
 */
const items = ref<Liquidacion[]>([]);
const total = ref(0);

const netoPorMoneda = computed(() => {
  const por = new Map<string, number>();
  for (const l of items.value) {
    por.set(l.moneda, (por.get(l.moneda) ?? 0) + l.totalNeto);
  }
  return [...por.entries()].map(([moneda, monto]) => ({ moneda, monto }));
});
const paginas = ref(1);
const pagina = ref(1);
/**
 * El período y el estado salen de la URL si vienen, y del mes corriente si no.
 *
 * Es lo que hace que «Liquidaciones sin cerrar: 2» del inicio caiga donde
 * están esos dos borradores. Se leen una vez al montar y después mandan los
 * controles: si el usuario cambia el mes, la query deja de ser la verdad.
 */
const ruta = useRoute();
const qsPeriodo = String(ruta.query.periodo ?? '');
const mes = ref(
  /^\d{4}-\d{2}$/.test(qsPeriodo) ? qsPeriodo : new Date().toISOString().slice(0, 7),
);
const q = ref('');
const filtroEstado = ref(
  ['borrador', 'cerrada', 'pagada'].includes(String(ruta.query.estado))
    ? String(ruta.query.estado)
    : '',
);
const cargando = ref(true);
const error = ref('');
const abierta = ref<string | null>(null);

const ETIQUETA: Record<string, string> = { borrador: 'Borrador', cerrada: 'Cerrada', pagada: 'Pagada' };

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const r = await api<Pagina<Liquidacion>>(
      `/liquidaciones?${consulta(
        { pagina: pagina.value, porPagina: POR_PAGINA },
        { periodo: `${mes.value}-01`, q: q.value.trim(), estado: filtroEstado.value },
      )}`,
    );
    items.value = r.items;
    total.value = r.total;
    paginas.value = r.paginas;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar.';
  } finally { cargando.value = false; }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
watch([q, filtroEstado, mes], () => {
  clearTimeout(debounce);
  pagina.value = 1;
  debounce = setTimeout(cargar, 220);
});
watch(pagina, () => void cargar());

async function generar() {
  error.value = '';
  try {
    const r = await api<{ generadas: number; omitidasCerradas: number }>(
      '/liquidaciones/generar',
      { method: 'POST', body: JSON.stringify({ periodo: `${mes.value}-01` }) },
    );
    await cargar();
    ui.ok(
      `${plural(r.generadas, 'liquidación armada', 'liquidaciones armadas')}`,
      r.omitidasCerradas
        ? `${r.omitidasCerradas} ya estaban cerradas y no se tocaron`
        : `período ${fmtPeriodo(`${mes.value}-01`)}`,
    );
  } catch (e) {
    const detalle = e instanceof ApiError ? e.paraMostrar : 'No se pudo generar.';
    error.value = detalle;
    ui.error('No se pudo generar el período', detalle);
  }
}

/** Cerrar es irreversible por trigger: los números quedan congelados. */
async function cerrar(id: string) {
  error.value = '';
  const l = items.value.find((x) => x.id === id);

  const ok = await ui.confirmar({
    titulo: '¿Cerrar la liquidación?',
    detalle: l
      ? `Quedan congelados ${money(l.totalNeto, l.moneda)} a nombre de ` +
        `${l.propietario.nombre}. Después no se modifica: un pago tardío de ese ` +
        'mes va a la liquidación siguiente.'
      : 'Después de cerrarla, los números no se modifican.',
    confirmar: 'Cerrar la liquidación',
  });
  if (!ok) return;

  try {
    await api(`/liquidaciones/${id}/cerrar`, { method: 'POST' });
    await cargar();
    ui.ok('Liquidación cerrada', l ? money(l.totalNeto, l.moneda) : undefined);
  } catch (e) {
    const detalle = e instanceof ApiError ? e.paraMostrar : 'No se pudo cerrar.';
    error.value = detalle;
    ui.error('No se pudo cerrar la liquidación', detalle);
  }
}

async function exportar() {
  error.value = '';
  try { await descargar(`/exportar/liquidaciones.csv?periodo=${mes.value}-01`); }
  catch (e) { error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo exportar.'; }
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Liquidaciones"
      bajada="Se liquida lo COBRADO, no lo facturado. En condominio, cada propietario recibe la suya.">
      <template #acciones>
        <!-- Sin @change: el watch de `mes` ya recarga, y con los dos se pedía dos veces. -->
        <input v-model="mes" type="month" class="mes" />
        <button class="btn secondary" type="button" @click="exportar">Exportar</button>
        <button class="btn" type="button" @click="generar">Generar</button>
      </template>
    </PageHeader>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="filtros">
      <SearchInput v-model="q" placeholder="Propietario…" />
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

    <!--
      El total va ARRIBA de la lista y no al pie: es lo que se viene a buscar, y
      al pie de treinta filas hay que scrollear para encontrarlo.

      Y va FUERA de la cadena `v-if / v-else-if / v-else` de abajo, con su
      propio `v-if`. La primera versión lo metió adentro como un `v-else-if`, y
      como la cadena es excluyente, el total se dibujaba y las liquidaciones
      desaparecían. Se vio abriendo la pantalla: el número estaba y la lista no.
    -->
    <div v-if="!cargando && items.length" class="total-mes">
      <span class="et">
        A pagar en {{ fmtPeriodo(mes + '-01') }}
        <template v-if="items.length !== total">· {{ items.length }} de {{ total }}</template>
      </span>
      <span class="cifras">
        <b v-for="m in netoPorMoneda" :key="m.moneda" class="mono">{{ money(m.monto, m.moneda) }}</b>
      </span>
    </div>

    <UiSkeleton v-if="cargando" :filas="3" :alto="72" />

    <UiEmpty
      v-else-if="!items.length && (q || filtroEstado)"
      titulo="Ninguna liquidación coincide"
      detalle="Probá con otro propietario, otro estado u otro mes."
    />
    <UiEmpty v-else-if="!items.length" :titulo="`Sin liquidaciones para ${fmtPeriodo(mes + '-01')}`"
      detalle="Se arman con los cobros del período que todavía no fueron rendidos. Registrá los cobros y generá." >
      <button class="btn" type="button" @click="generar">Generar el período</button>
    </UiEmpty>

    <!-- `v-else` y no `v-if="items.length"`: `v-if` y `v-for` en el mismo
         elemento es un antipatrón en Vue 3, y acá además no hace falta —el
         bloque del total ya cierra la cadena con su `v-else-if`—. -->
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

    <UiPager
      v-if="!cargando"
      v-model:pagina="pagina"
      :paginas="paginas"
      :total="total"
      :por-pagina="POR_PAGINA"
      sustantivo="liquidaciones"
    />
  </div>
</template>

<style scoped>

.mes { font: inherit; padding: var(--s-sm) var(--s-md); border: 1px solid var(--line-strong); border-radius: var(--r-md); background: var(--surface); color: var(--ink); }
.liq { padding: 0; overflow: hidden; }
.total-mes {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: var(--s-md); flex-wrap: wrap;
  padding: var(--s-md) var(--s-lg);
  background: var(--surface-2); border-radius: var(--r-md);
}
.total-mes .et { color: var(--muted); font-size: 13px; }
.total-mes .cifras { display: flex; gap: var(--s-lg); flex-wrap: wrap; }
.total-mes b { font-size: 18px; font-variant-numeric: tabular-nums; }

.liq header { display: flex; align-items: center; gap: var(--s-xl); padding: var(--s-lg); cursor: pointer; flex-wrap: wrap; }
.liq header:hover { background: var(--surface-2); }
.quien { margin: 0; font-weight: 500; color: var(--ink); }
.cuando { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
.totales { display: flex; gap: var(--s-xl); margin-left: auto; flex-wrap: wrap; }
.totales > div { display: flex; flex-direction: column; align-items: flex-end; }
.et { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-2); }
.totales .mono { font-size: 13px; color: var(--ink-2); }
.neto .mono { font-size: 16px; color: var(--ink); font-weight: 500; }
.detalle { border-top: 1px solid var(--line); background: var(--surface-2); padding: var(--s-lg); }
.detalle table { width: 100%; border-collapse: collapse; font-size: 13px; }
.detalle td { padding: var(--s-xs) 0; color: var(--ink-2); }
.acciones { margin-top: var(--s-md); }
</style>
