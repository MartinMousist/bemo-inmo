<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiPager from '../componentes/UiPager.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha, proximidad } from '../dominio/formato';
import { consulta, type Pagina } from '../dominio/pagina';

interface Aviso {
  id: string; tipo: string; titulo: string; detalle: string | null;
  disparaEl: string; estado: string;
}
interface Canal { canal: string; disponible: boolean; detalle: string }

const TIPO: Record<string, string> = {
  contrato_por_vencer: 'Contrato', ajuste_por_aplicar: 'Aumento',
  cuota_impaga: 'Cuota', reserva_por_vencer: 'Reserva',
  visita_agendada: 'Visita', garantia_por_vencer: 'Garantía',
  // Se llama distinto de «Garantía» a propósito: uno pide renovar un papel que
  // se vence y el otro pide volver a consultar el BCRA. Con la misma etiqueta,
  // el filtro por tipo mezcla dos tareas que no se hacen igual.
  garantia_revision_bcra: 'Revisión BCRA',
};

const POR_PAGINA = 50;

const items = ref<Aviso[]>([]);
const total = ref(0);
const paginas = ref(1);
const pagina = ref(1);
const canales = ref<Canal[]>([]);
const futuros = ref(false);
const filtroTipo = ref('');
const cargando = ref(true);
const error = ref('');

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const [a, c] = await Promise.all([
      api<Pagina<Aviso>>(
        `/avisos?${consulta(
          { pagina: pagina.value, porPagina: POR_PAGINA },
          { futuros: futuros.value, tipo: filtroTipo.value },
        )}`,
      ),
      api<Canal[]>('/avisos/canales'),
    ]);
    items.value = a.items;
    total.value = a.total;
    paginas.value = a.paginas;
    canales.value = c;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los avisos.';
  } finally { cargando.value = false; }
}

watch([futuros, filtroTipo], () => {
  pagina.value = 1;
  void cargar();
});
watch(pagina, () => void cargar());

async function generar() {
  error.value = '';
  try { await api('/avisos/generar', { method: 'POST' }); await cargar(); }
  catch (e) { error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo recalcular.'; }
}

async function visto(id: string) {
  try { await api(`/avisos/${id}/visto`, { method: 'POST' }); await cargar(); }
  catch (e) { error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo marcar.'; }
}

const sinEnviar = computed(() => canales.value.filter((c) => !c.disponible));

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Avisos" :bajada="cargando ? '' : `${total} para revisar`">
      <template #acciones>
        <!-- Sin @change: el watch de `futuros` recarga y además vuelve a la página 1. -->
        <label class="toggle">
          <input v-model="futuros" type="checkbox" />
          <span>Ver los que vienen</span>
        </label>
        <button class="btn" type="button" @click="generar">Recalcular</button>
      </template>
    </PageHeader>

    <!-- Honestidad de producto: se dice qué canales NO envían todavía y por qué,
         en vez de mostrar un botón "enviar" que no manda nada. -->
    <div v-if="sinEnviar.length" class="canales">
      <p><strong>Los avisos se ven acá dentro.</strong> Todavía no salen solos por:</p>
      <ul>
        <li v-for="c in sinEnviar" :key="c.canal">
          <StatusChip :texto="c.canal" tono="warn" /> <span>{{ c.detalle }}</span>
        </li>
      </ul>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <!-- `scroll`: son muchos estados y en pantalla angosta la barra scrollea
         en vez de empujar el ancho de la página. -->
    <div class="segmented scroll">
      <button type="button" :class="{ activo: filtroTipo === '' }" @click="filtroTipo = ''">
        Todos
      </button>
      <button
        v-for="(etiqueta, clave) in TIPO"
        :key="clave"
        type="button"
        :class="{ activo: filtroTipo === clave }"
        @click="filtroTipo = clave"
      >
        {{ etiqueta }}
      </button>
    </div>

    <UiSkeleton v-if="cargando" :filas="4" :alto="56" />

    <UiEmpty
      v-else-if="!items.length && filtroTipo"
      titulo="Nada de ese tipo"
      detalle="Sacá el filtro para ver el resto de los avisos."
    />
    <UiEmpty v-else-if="!items.length" titulo="Nada por revisar"
      detalle="Cuando haya contratos por vencer, aumentos por aplicar o cuotas impagas, aparecen acá.">
      <button class="btn" type="button" @click="generar">Recalcular ahora</button>
    </UiEmpty>

    <div v-else class="card sin-padding">
      <ul class="lista">
        <li v-for="a in items" :key="a.id">
          <StatusChip :texto="TIPO[a.tipo] ?? a.tipo" tono="acento" />
          <div class="que">
            <span class="titulo">{{ a.titulo }}</span>
            <span v-if="a.detalle" class="detalle mono">{{ a.detalle }}</span>
          </div>
          <span class="mono cuando">{{ fecha(a.disparaEl) }}</span>
          <StatusChip :texto="proximidad(a.disparaEl).texto"
            :tono="proximidad(a.disparaEl).tono === 'neutro' ? 'neutro' : proximidad(a.disparaEl).tono === 'warn' ? 'warn' : 'err'" />
          <button class="btn secondary sm" type="button" @click="visto(a.id)">Listo</button>
        </li>
      </ul>
    </div>

    <UiPager
      v-if="!cargando"
      v-model:pagina="pagina"
      :paginas="paginas"
      :total="total"
      :por-pagina="POR_PAGINA"
      sustantivo="avisos"
    />
  </div>
</template>

<style scoped>

.toggle { display: inline-flex; align-items: center; gap: var(--s-xs); font-size: 13px; color: var(--muted); }
.canales { padding: var(--s-md) var(--s-lg); background: var(--warning-tint); border: 1px solid var(--warning-line); border-radius: var(--r-md); font-size: 13px; color: var(--warning); }
.canales p { margin: 0 0 var(--s-sm); }
.canales ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-xs); }
.canales li { display: flex; gap: var(--s-sm); align-items: center; }
.lista li { display: grid; grid-template-columns: auto 1fr auto auto auto; align-items: center; gap: var(--s-md); padding: var(--s-md) var(--s-lg); border-bottom: 1px solid var(--line); font-size: 13px; }
.que { display: flex; flex-direction: column; }
.titulo { color: var(--ink); }
.detalle { font-size: 12px; color: var(--muted); }
.cuando { color: var(--muted); }
@media (max-width: 760px) { .lista li { grid-template-columns: 1fr auto; } .cuando { display: none; } }
</style>
