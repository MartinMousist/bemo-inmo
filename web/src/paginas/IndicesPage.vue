<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiPager from '../componentes/UiPager.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { periodo as fmtPeriodo } from '../dominio/formato';
import { consulta, type Pagina } from '../dominio/pagina';

interface Cobertura { tipo: string; ultimo: string | null; valores: number }
interface Valor { tipo: string; periodo: string; valor: number; fuente: string }

const NOMBRE: Record<string, string> = {
  ipc: 'IPC · INDEC', icl: 'ICL · BCRA', uva: 'UVA · BCRA', icp: 'Casa Propia',
};

// 12 períodos por año: una página de 60 son cinco años de historia de un índice.
const POR_PAGINA = 60;

const cobertura = ref<Cobertura[]>([]);
const valores = ref<Valor[]>([]);
const total = ref(0);
const paginas = ref(1);
const pagina = ref(1);
const tipoVisto = ref('ipc');
const cargando = ref(true);
const error = ref('');
const ok = ref('');

const alta = reactive({ abierta: false, tipo: 'ipc', periodo: '', valor: '' });

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const [c, v] = await Promise.all([
      api<Cobertura[]>('/indices/cobertura'),
      api<Pagina<Valor>>(
        `/indices?${consulta(
          { pagina: pagina.value, porPagina: POR_PAGINA },
          { tipo: tipoVisto.value },
        )}`,
      ),
    ]);
    cobertura.value = c;
    valores.value = v.items;
    total.value = v.total;
    paginas.value = v.paginas;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los índices.';
  } finally { cargando.value = false; }
}

watch(pagina, () => void cargar());

async function guardar() {
  error.value = ''; ok.value = '';
  try {
    await api('/indices', {
      method: 'POST',
      body: JSON.stringify({
        tipo: alta.tipo,
        periodo: `${alta.periodo}-01`,
        valor: Number(alta.valor),
      }),
    });
    ok.value = `${alta.tipo.toUpperCase()} ${alta.periodo} cargado.`;
    alta.periodo = ''; alta.valor = '';
    tipoVisto.value = alta.tipo;
    await cargar();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar el valor.';
  }
}

function verTipo(t: string) {
  tipoVisto.value = t;
  // Cambiar de índice vuelve a la primera página: quedarse en la 3 de un índice
  // con 74 períodos al mirar otro que tiene 12 muestra una tabla vacía.
  if (pagina.value !== 1) pagina.value = 1;
  else void cargar();
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Índices"
      bajada="Los valores son compartidos por todas las cuentas. Una vez cargado, un período no se pisa.">
      <template #acciones>
        <button class="btn" type="button" @click="alta.abierta = !alta.abierta">Cargar valor</button>
      </template>
    </PageHeader>

    <div class="cobertura">
      <button v-for="c in cobertura" :key="c.tipo" type="button" class="tarjeta"
              :class="{ activa: tipoVisto === c.tipo }" @click="verTipo(c.tipo)">
        <span class="nombre">{{ NOMBRE[c.tipo] ?? c.tipo }}</span>
        <span v-if="c.ultimo" class="hasta mono">hasta {{ fmtPeriodo(c.ultimo) }}</span>
        <StatusChip v-else texto="Sin datos" tono="warn" />
        <span class="cuenta mono">{{ c.valores }} períodos</span>
      </button>
    </div>

    <form v-if="alta.abierta" class="card stack" @submit.prevent="guardar">
      <div class="row">
        <label class="campo"><span>Índice</span>
          <select v-model="alta.tipo">
            <option v-for="(n, k) in NOMBRE" :key="k" :value="k">{{ n }}</option>
          </select>
        </label>
        <label class="campo"><span>Mes</span><input v-model="alta.periodo" type="month" required /></label>
        <label class="campo"><span>Valor</span><input v-model="alta.valor" inputmode="decimal" required /></label>
        <button class="btn" type="submit">Guardar</button>
      </div>
      <!--
        Este texto decía que la ingesta automática "llega en la etapa 7". Ya llegó
        para ICL y UVA, y para IPC no va a llegar: INDEC no publica una API estable.
        Un texto viejo en una pantalla de índices es una promesa que no se cumple.
      -->
      <p class="nota">
        ICL y UVA se traen solos del BCRA con «Sincronizar». El IPC de INDEC es manual
        a propósito: no hay una API estable, y raspar un HTML que cambia sin aviso
        pondría un número equivocado en un aviso de aumento. La carga a mano queda
        además como respaldo cuando una fuente falla.
      </p>
    </form>

    <p v-if="ok" class="aviso-ok" role="status">{{ ok }}</p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="card sin-padding">
      <UiSkeleton v-if="cargando" :filas="5" />
      <table v-else-if="valores.length">
        <thead><tr><th>Período</th><th class="der">Valor</th><th>Fuente</th></tr></thead>
        <tbody>
          <tr v-for="v in valores" :key="v.periodo">
            <td class="mono">{{ fmtPeriodo(v.periodo) }}</td>
            <td class="der mono fuerte">{{ v.valor }}</td>
            <td class="fuente">{{ v.fuente }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="vacio">Todavía no hay valores de {{ NOMBRE[tipoVisto] }}.</p>
    </div>

    <UiPager
      v-if="!cargando"
      v-model:pagina="pagina"
      :paginas="paginas"
      :total="total"
      :por-pagina="POR_PAGINA"
      sustantivo="períodos"
    />
  </div>
</template>

<style scoped>
.cobertura { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--s-md); }
.tarjeta { display: flex; flex-direction: column; gap: var(--s-xs); align-items: flex-start; padding: var(--s-lg); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); cursor: pointer; font: inherit; text-align: left; }
.tarjeta.activa { border-color: var(--accent-line); background: var(--accent-tint); }
.nombre { font-weight: 500; color: var(--ink); font-size: 13px; }
.hasta { font-size: 12px; color: var(--muted); }
.cuenta { font-size: 11px; color: var(--muted-2); }
.campo input, .campo select { font: inherit; padding: var(--s-sm) var(--s-md); border: 1px solid var(--line-strong); border-radius: var(--r-md); background: var(--surface); color: var(--ink); }
td { padding: var(--s-sm) var(--s-lg); border-bottom: 1px solid var(--line); color: var(--ink-2); }
.fuente { color: var(--muted-2); font-size: 12px; }
.vacio { padding: var(--s-2xl); text-align: center; color: var(--muted); }
/* `.aviso-ok` y no `.ok`: el scoped del padre alcanza al elemento raíz del hijo,
   y el raíz de un `StatusChip` con tono ok es un `span.chip.ok`. Hoy esta
   pantalla sólo pinta chips `warn`, pero el día que aparezca uno verde se lleva
   el padding de cartel y `--success` en vez de `--success-ink` —4,33:1 sobre el
   tint, AA fallado a 13px—. Pasó de verdad en la ficha del contrato. */
.aviso-ok { margin: 0; padding: var(--s-sm) var(--s-md); background: var(--success-tint); border: 1px solid var(--success-line); border-radius: var(--r-md); color: var(--success-ink); font-size: 13px; }
</style>
