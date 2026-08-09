<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import { fecha } from '../dominio/formato';
import { filtrosRecordados } from '../dominio/filtros';
import PageHeader from '../componentes/PageHeader.vue';
import SearchInput from '../componentes/SearchInput.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiPager from '../componentes/UiPager.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';

interface Garante {
  id: string;
  contratoId: string;
  personaId: string | null;
  nombre: string;
  documento: string | null;
  tipo: string; tipoTexto: string;
  venceEl: string | null; vencida: boolean;
  firmoEl: string | null;
  bcra: {
    consultado: boolean; situacion: number | null; situacionTexto: string | null;
    consultadoEl: string | null; apto: boolean | null; motivo: string | null;
    revisarEl: string | null; revisionVencida: boolean;
  };
  documentos: Array<{ tipo: string }>;
  faltan: string[];
  legajoCompleto: boolean;
  contrato: { id: string; estado: string; desde: string; hasta: string };
  propiedad: { id: string; etiqueta: string; direccion: string };
}

const ESTADOS = [
  { clave: 'pendientes', texto: 'Necesitan algo' },
  { clave: 'observados', texto: 'Observados' },
  { clave: 'aptos', texto: 'Completos' },
  { clave: 'todos', texto: 'Todos' },
] as const;

const { valores: filtros } = filtrosRecordados(
  'garantes',
  { estado: 'pendientes', vigencia: 'vigentes' },
  {
    estado: ESTADOS.map((e) => e.clave),
    vigencia: ['vigentes', 'todos'],
  },
);

const items = ref<Garante[]>([]);
const total = ref(0);
const pagina = ref(1);
const porPagina = 25;
const paginas = ref(1);
const q = ref('');
const cargando = ref(true);
const error = ref('');

const bajada = computed(() => {
  if (cargando.value) return '';
  const n = `${total.value} ${total.value === 1 ? 'garantía' : 'garantías'}`;
  return filtros.value.estado === 'pendientes'
    ? `${n} con algo pendiente`
    : n;
});

/**
 * El total de documentos que se le piden a esta garantía.
 *
 * Cinco para una garantía con persona (DNI x2 + tres recibos), UNO para una sin
 * persona: a un seguro de caución no se le piden recibos de sueldo, se le pide
 * la póliza. Pedirle cinco es una lista de pendientes que nunca se va a poder
 * completar, mostrada al lado de las que sí.
 */
function legajoDe(g: Garante): { tiene: number; total: number } {
  const total = g.personaId ? 5 : 1;
  return { tiene: total - g.faltan.length, total };
}

/** El veredicto del BCRA, derivado. Sin consulta NO hay veredicto. */
function bcraChip(g: Garante): { texto: string; tono: 'ok' | 'warn' | 'err' | 'neutro' } {
  if (!g.personaId) return { texto: 'No corresponde', tono: 'neutro' };
  if (!g.bcra.consultado) return { texto: 'Sin consultar', tono: 'warn' };
  if (g.bcra.apto === false) return { texto: 'Observado', tono: 'err' };
  // La revisión vencida INFORMA, no rechaza: es un dato viejo, no un no.
  if (g.bcra.revisionVencida) return { texto: 'A revisar', tono: 'warn' };
  return { texto: `Situación ${g.bcra.situacion ?? '—'}`, tono: 'ok' };
}

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const p = new URLSearchParams({ pagina: String(pagina.value), porPagina: String(porPagina) });
    if (q.value.trim()) p.set('q', q.value.trim());
    p.set('estado', filtros.value.estado);
    p.set('vigencia', filtros.value.vigencia);

    const r = await api<{ items: Garante[]; total: number; paginas: number }>(`/garantes?${p}`);
    items.value = r.items; total.value = r.total; paginas.value = r.paginas;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los garantes.';
  } finally { cargando.value = false; }
}

let deb: ReturnType<typeof setTimeout> | undefined;
watch(q, () => { clearTimeout(deb); pagina.value = 1; deb = setTimeout(cargar, 220); });
watch(filtros, () => { pagina.value = 1; void cargar(); }, { deep: true });
watch(pagina, cargar);

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Garantes" :bajada="bajada">
      <template #acciones>
        <RouterLink class="btn secondary" to="/personas?rol=garante">Ver en Personas</RouterLink>
      </template>
    </PageHeader>

    <!--
      ⚠️ Acá NO hay ningún botón de «consultar el BCRA de todos».

      Es el incidente ya anotado —una consulta con un DNI del seed devolvió el
      nombre y la deuda bancaria de una persona real— repetido a escala. Desde
      esta pantalla se VE qué falta; la consulta se aprieta en el contrato, de a
      una, y queda el nombre de quien la apretó. Además la API del BCRA limita
      por IP y devuelve 429.
    -->
    <p class="nota">
      La fila es una <strong>garantía</strong>: una persona puede garantizar dos contratos y
      el legajo es de cada uno. La consulta al BCRA se hace desde el contrato, de a una.
    </p>

    <div class="filtros">
      <SearchInput v-model="q" placeholder="Garante, documento, dirección o código…" />

      <div class="segmented scroll" role="group" aria-label="Estado del legajo">
        <button
          v-for="e in ESTADOS"
          :key="e.clave"
          type="button"
          :aria-pressed="filtros.estado === e.clave"
          @click="filtros.estado = e.clave"
        >{{ e.texto }}</button>
      </div>

      <div class="segmented" role="group" aria-label="Vigencia del contrato">
        <button type="button" :aria-pressed="filtros.vigencia === 'vigentes'"
          @click="filtros.vigencia = 'vigentes'">Contratos vigentes</button>
        <button type="button" :aria-pressed="filtros.vigencia === 'todos'"
          @click="filtros.vigencia = 'todos'">Todos</button>
      </div>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="card sin-padding">
      <UiSkeleton v-if="cargando" :filas="6" />
      <UiEmpty
        v-else-if="!items.length"
        :titulo="
          q
            ? `Ningún garante coincide con «${q}»`
            : filtros.estado === 'pendientes'
              ? 'No hay ninguna garantía con algo pendiente'
              : 'No hay ninguna garantía cargada todavía'
        "
        detalle="Las garantías se cargan desde el legajo de cada contrato de alquiler, con sus documentos y su firma."
      >
        <button v-if="q" class="btn secondary" type="button" @click="q = ''">Limpiar la búsqueda</button>
        <RouterLink v-else class="btn secondary" to="/contratos">Ir a Contratos</RouterLink>
      </UiEmpty>

      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Garante</th>
              <th>Contrato</th>
              <th>Tipo</th>
              <th class="num">Legajo</th>
              <th>Firmó el</th>
              <th>BCRA</th>
              <th>Revisar el</th>
              <th>Vence el</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in items" :key="g.id">
              <td class="fuerte">
                <RouterLink :to="`/contratos/${g.contratoId}`">{{ g.nombre }}</RouterLink>
                <!-- `bloque`: sin él el DNI se pega al apellido y sale
                     «Adriana RossiDNI 17889900». Visto en la app. -->
                <span v-if="g.documento" class="chico mono bloque">DNI {{ g.documento }}</span>
              </td>
              <td>
                <div class="apilado">
                  <span class="mono">{{ g.propiedad.etiqueta }}</span>
                  <span class="chico">{{ g.propiedad.direccion }}</span>
                </div>
              </td>
              <td class="chico">{{ g.tipoTexto }}</td>
              <td class="num">
                <!-- n/5 (o n/1 para una caución) y no un tilde: «3/5» dice
                     cuánto falta, un ✓ o una cruz no. -->
                <span :class="{ falta: !g.legajoCompleto }">
                  {{ legajoDe(g).tiene }}/{{ legajoDe(g).total }}
                </span>
              </td>
              <td class="chico">
                <span v-if="g.firmoEl">{{ fecha(g.firmoEl) }}</span>
                <span v-else class="falta">Sin firmar</span>
              </td>
              <td>
                <StatusChip :texto="bcraChip(g).texto" :tono="bcraChip(g).tono" />
                <span v-if="g.bcra.consultadoEl" class="chico bloque">
                  el {{ fecha(g.bcra.consultadoEl.slice(0, 10)) }}
                </span>
              </td>
              <td class="chico">
                <span v-if="g.bcra.revisarEl" :class="{ falta: g.bcra.revisionVencida }">
                  {{ fecha(g.bcra.revisarEl) }}
                </span>
                <span v-else class="muted">—</span>
              </td>
              <td class="chico">
                <span v-if="g.venceEl" :class="{ falta: g.vencida }">{{ fecha(g.venceEl) }}</span>
                <span v-else class="muted">Sin vencimiento</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <UiPager
      v-if="!cargando && total > porPagina"
      v-model:pagina="pagina"
      :paginas="paginas"
      :total="total"
      :por-pagina="porPagina"
      sustantivo="garantías"
    />
  </div>
</template>

<style scoped>
.filtros { display: flex; gap: var(--s-md); align-items: center; flex-wrap: wrap; }
.filtros > :first-child { flex: 1; min-width: 220px; }
.apilado { display: flex; flex-direction: column; gap: 2px; }
.chico { font-size: 12px; color: var(--muted); }
.bloque { display: block; margin-top: 2px; }
.muted { color: var(--muted-2); }
.num { text-align: right; }
.nota { margin: 0; font-size: 13px; color: var(--muted); }
/* Medido sobre `--surface`: claro #b23a32 → 5,93 · oscuro #d9756c → 5,39. */
.falta { color: var(--danger-ink); font-weight: 500; }
</style>
