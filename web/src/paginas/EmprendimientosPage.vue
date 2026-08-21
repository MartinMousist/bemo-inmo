<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { useAuth } from '../stores/auth';
import { fecha } from '../dominio/formato';

/**
 * Los emprendimientos, con su avance y su stock.
 *
 * ── Las tres cifras que van juntas ──
 *
 * Disponibles, reservadas y vendidas. Un desarrollador no pregunta «cuántas
 * unidades tiene la torre» —eso lo sabe— sino **cuántas le quedan**. Por eso el
 * total va chico y el desglose grande.
 *
 * ── El atraso, cuando lo hay ──
 *
 * Si la entrega se corrió respecto de lo prometido, se dice con el número de
 * meses. Es el dato que el desarrollador no quiere ver y que sus compradores
 * preguntan primero; esconderlo no lo hace desaparecer.
 */

interface Emprendimiento {
  id: string; nombre: string; direccion: string; etapa: string;
  avancePct: number; avanceEl: string | null;
  entregaEstimada: string | null; entregaOriginal: string | null;
  atrasoMeses: number | null;
  unidades: { total: number; disponibles: number; reservadas: number; vendidas: number };
  planes: number;
}

const ETAPA: Record<string, string> = {
  pozo: 'En pozo',
  en_construccion: 'En construcción',
  terminado: 'Terminado',
  entregado: 'Entregado',
};

const auth = useAuth();
const lista = ref<Emprendimiento[]>([]);
const cargando = ref(true);
const error = ref('');
const guardando = ref(false);

const abrirAlta = ref(false);
const nuevo = reactive({
  nombre: '', calle: '', numero: '', localidad: '', etapa: 'pozo', entregaEstimada: '',
});

const esJefe = () => auth.rol === 'owner' || auth.rol === 'admin';

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    lista.value = await api<Emprendimiento[]>('/emprendimientos');
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar.';
  } finally { cargando.value = false; }
}

async function crear() {
  guardando.value = true; error.value = '';
  try {
    await api('/emprendimientos', {
      method: 'POST',
      body: JSON.stringify({
        nombre: nuevo.nombre, calle: nuevo.calle,
        numero: nuevo.numero || undefined,
        localidad: nuevo.localidad || undefined,
        etapa: nuevo.etapa,
        entregaEstimada: nuevo.entregaEstimada || undefined,
      }),
    });
    abrirAlta.value = false;
    nuevo.nombre = ''; nuevo.calle = ''; nuevo.numero = ''; nuevo.entregaEstimada = '';
    await cargar();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo crear.';
  } finally { guardando.value = false; }
}

/** Cuánto se vendió, en porcentaje. Es el número que mide el éxito del proyecto. */
const vendidoPct = (e: Emprendimiento) =>
  e.unidades.total ? Math.round(e.unidades.vendidas / e.unidades.total * 100) : 0;

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Emprendimientos"
      :bajada="cargando ? 'Cargando…' : `${lista.length} proyectos`">
      <template #acciones>
        <button v-if="esJefe()" class="btn" type="button" @click="abrirAlta = !abrirAlta">
          {{ abrirAlta ? 'Cancelar' : 'Nuevo emprendimiento' }}
        </button>
      </template>
    </PageHeader>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <section v-if="abrirAlta" class="card stack">
      <h2>Nuevo emprendimiento</h2>
      <form class="stack" @submit.prevent="crear">
        <div class="grilla">
          <label class="campo">
            <span>Nombre</span>
            <input v-model="nuevo.nombre" required minlength="2" maxlength="120"
              placeholder="Torre Aconcagua" />
          </label>
          <label class="campo">
            <span>Etapa</span>
            <select v-model="nuevo.etapa">
              <option v-for="(t, k) in ETAPA" :key="k" :value="k">{{ t }}</option>
            </select>
          </label>
          <label class="campo">
            <span>Calle</span>
            <input v-model="nuevo.calle" required minlength="2" />
          </label>
          <label class="campo">
            <span>Número</span>
            <input v-model="nuevo.numero" maxlength="20" />
          </label>
          <label class="campo">
            <span>Localidad</span>
            <input v-model="nuevo.localidad" maxlength="80" />
          </label>
          <label class="campo">
            <span>Entrega estimada</span>
            <input v-model="nuevo.entregaEstimada" type="date" />
            <!-- Se avisa acá porque después no se puede cambiar sin dejar
                 rastro, y esa es justamente la gracia. -->
            <small>Queda congelada como la fecha prometida: el atraso se mide contra ella.</small>
          </label>
        </div>
        <div>
          <button class="btn" type="submit" :disabled="guardando">
            {{ guardando ? 'Creando…' : 'Crear' }}
          </button>
        </div>
      </form>
    </section>

    <UiSkeleton v-if="cargando" :filas="2" :alto="120" />

    <UiEmpty
      v-else-if="!lista.length"
      titulo="Todavía no hay emprendimientos"
      detalle="Un emprendimiento agrupa las unidades de un mismo proyecto: se cargan de una vez desde una planilla y se venden con plan de pago." />

    <RouterLink
      v-for="e in lista"
      v-else
      :key="e.id"
      :to="`/emprendimientos/${e.id}`"
      class="card proyecto"
    >
      <div class="cab">
        <div>
          <strong>{{ e.nombre }}</strong>
          <span class="dir">{{ e.direccion }}</span>
        </div>
        <StatusChip :texto="ETAPA[e.etapa] ?? e.etapa"
          :tono="e.etapa === 'entregado' ? 'ok' : e.etapa === 'pozo' ? 'warn' : 'neutro'" />
      </div>

      <!-- El avance de obra, con su fecha. Un porcentaje sin fecha no dice nada. -->
      <div v-if="e.avancePct > 0" class="avance">
        <div class="barra"><span :style="{ width: `${e.avancePct}%` }" /></div>
        <span class="pct mono">{{ e.avancePct }}%</span>
        <span v-if="e.avanceEl" class="cuando">al {{ fecha(e.avanceEl) }}</span>
      </div>

      <div class="cifras">
        <div>
          <span class="num mono">{{ e.unidades.disponibles }}</span>
          <span class="et">disponibles</span>
        </div>
        <div>
          <span class="num mono">{{ e.unidades.reservadas }}</span>
          <span class="et">reservadas</span>
        </div>
        <div>
          <span class="num mono">{{ e.unidades.vendidas }}</span>
          <span class="et">vendidas</span>
        </div>
        <div class="total">
          <span class="num mono">{{ vendidoPct(e) }}%</span>
          <span class="et">colocado · {{ e.unidades.total }} unidades</span>
        </div>
      </div>

      <p class="pie">
        <template v-if="e.entregaEstimada">Entrega {{ fecha(e.entregaEstimada) }}</template>
        <template v-else>Sin fecha de entrega</template>
        <!-- El atraso se dice con su número. Es el dato que el desarrollador no
             quiere ver y que sus compradores preguntan primero. -->
        <span v-if="e.atrasoMeses && e.atrasoMeses > 0" class="atraso">
          · {{ e.atrasoMeses }} {{ e.atrasoMeses === 1 ? 'mes' : 'meses' }} más tarde de lo prometido
        </span>
        <span v-if="e.planes" class="planes">· {{ e.planes }} planes de pago</span>
      </p>
    </RouterLink>
  </div>
</template>

<style scoped>
h2 { margin: 0; font-size: 15px; }
.grilla { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--s-md); }
.campo { display: flex; flex-direction: column; gap: var(--s-2xs); }
.campo input, .campo select {
  font: inherit; padding: 8px var(--s-md); border: 1px solid var(--line-strong);
  border-radius: var(--r-md); background: var(--surface); color: var(--ink);
}
.campo small { font-size: 11px; color: var(--muted); line-height: 1.5; }

.proyecto { display: flex; flex-direction: column; gap: var(--s-sm); text-decoration: none; color: inherit; }
.proyecto:hover { border-color: var(--accent); }
.cab { display: flex; align-items: flex-start; gap: var(--s-md); }
.cab > div { display: flex; flex-direction: column; margin-right: auto; }
.dir { font-size: 12px; color: var(--muted); }

.avance { display: flex; align-items: center; gap: var(--s-sm); }
.barra { flex: 1; height: 6px; background: var(--surface-2); border-radius: 999px; overflow: hidden; max-width: 320px; }
.barra span { display: block; height: 100%; background: var(--accent); }
.pct { font-size: 12px; }
.cuando { font-size: 11px; color: var(--muted-2); }

.cifras { display: flex; gap: var(--s-xl); flex-wrap: wrap; }
.cifras > div { display: flex; flex-direction: column; }
.num { font-size: 20px; }
.et { font-size: 11px; color: var(--muted); }
.total .num { color: var(--accent-ink); }

.pie { margin: 0; font-size: 12px; color: var(--muted); }
.atraso { color: var(--warning); }
.planes { color: var(--muted-2); }
</style>
