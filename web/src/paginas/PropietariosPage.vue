<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import { moneyCorto, periodo } from '../dominio/formato';
import PageHeader from '../componentes/PageHeader.vue';
import SearchInput from '../componentes/SearchInput.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiPager from '../componentes/UiPager.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';

interface Unidad {
  id: string; etiqueta: string; direccion: string;
  porcentaje: number | null; administrada: boolean;
}
interface FilaPropietario {
  personaId: string; nombre: string; docNumero: string | null;
  unidades: Unidad[]; administradas: number;
  ultimasLiquidaciones: Array<{ moneda: string; periodo: string; estado: string; neto: number }>;
  pendiente: Array<{ moneda: string; monto: number }>;
  mesesSinLiquidar: number | null;
  tieneAcceso: boolean;
}

const ETIQUETA_ESTADO_LIQ: Record<string, string> = {
  borrador: 'Borrador', cerrada: 'Cerrada', pagada: 'Pagada',
};
const TONO_ESTADO_LIQ: Record<string, 'neutro' | 'warn' | 'ok'> = {
  borrador: 'neutro', cerrada: 'warn', pagada: 'ok',
};

const items = ref<FilaPropietario[]>([]);
const total = ref(0);
const pagina = ref(1);
const porPagina = 25;
const paginas = ref(1);
const q = ref('');
const soloConPendiente = ref(false);
const cargando = ref(true);
const error = ref('');

/** Qué filas están desplegadas. El detalle de unidades es opcional. */
const abiertas = ref(new Set<string>());
function alternar(id: string) {
  const s = new Set(abiertas.value);
  if (s.has(id)) s.delete(id); else s.add(id);
  abiertas.value = s;
}

const bajada = computed(() =>
  cargando.value ? '' : `${total.value} ${total.value === 1 ? 'propietario' : 'propietarios'}`,
);

/**
 * «Sin liquidar hace N meses», derivado del último período.
 *
 * `null` no es 0: uno es «nunca se le liquidó» y el otro «se le liquidó este
 * mes». Decirlos igual convierte un propietario nuevo en uno atrasado.
 */
function atraso(f: FilaPropietario): { texto: string; tono: 'neutro' | 'warn' | 'err' } | null {
  if (f.mesesSinLiquidar === null) return null;
  if (f.mesesSinLiquidar <= 1) return null;
  return {
    texto: `Sin liquidar hace ${f.mesesSinLiquidar} meses`,
    tono: f.mesesSinLiquidar >= 3 ? 'err' : 'warn',
  };
}

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const p = new URLSearchParams({ pagina: String(pagina.value), porPagina: String(porPagina) });
    if (q.value.trim()) p.set('q', q.value.trim());
    if (soloConPendiente.value) p.set('soloConPendiente', 'true');

    const r = await api<{ items: FilaPropietario[]; total: number; paginas: number }>(
      `/propietarios?${p}`,
    );
    items.value = r.items; total.value = r.total; paginas.value = r.paginas;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los propietarios.';
  } finally { cargando.value = false; }
}

let deb: ReturnType<typeof setTimeout> | undefined;
watch(q, () => { clearTimeout(deb); pagina.value = 1; deb = setTimeout(cargar, 220); });
watch(soloConPendiente, () => { pagina.value = 1; void cargar(); });
watch(pagina, cargar);

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Propietarios" :bajada="bajada">
      <template #acciones>
        <RouterLink class="btn secondary" to="/personas?rol=propietario">Ver en Personas</RouterLink>
        <RouterLink class="btn secondary" to="/liquidaciones">Liquidaciones</RouterLink>
      </template>
    </PageHeader>

    <div class="filtros">
      <SearchInput v-model="q" placeholder="Nombre o documento…" />
      <div class="segmented" role="group" aria-label="Filtrar por pendiente">
        <button type="button" :aria-pressed="!soloConPendiente" @click="soloConPendiente = false">
          Todos
        </button>
        <button type="button" :aria-pressed="soloConPendiente" @click="soloConPendiente = true">
          Con pendiente de liquidar
        </button>
      </div>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="card sin-padding">
      <UiSkeleton v-if="cargando" :filas="6" />
      <UiEmpty
        v-else-if="!items.length"
        :titulo="q ? `Ningún propietario coincide con «${q}»` : 'Todavía no hay propietarios'"
        detalle="Una persona es propietaria cuando figura como titular de una propiedad. Se carga desde la ficha de la propiedad, en Titulares."
      >
        <button v-if="q" class="btn secondary" type="button" @click="q = ''">Limpiar la búsqueda</button>
        <RouterLink v-else class="btn" to="/propiedades">Ir a Propiedades</RouterLink>
      </UiEmpty>

      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Propietario</th>
              <th class="num">Unidades</th>
              <th class="num">Administradas</th>
              <th>Última liquidación</th>
              <th class="num">Pendiente de liquidar</th>
              <th>Portal</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="f in items" :key="f.personaId">
              <tr>
                <td class="fuerte">
                  <!--
                    La fila se abre con un `<button>` y no con un `@click` sobre
                    el `<tr>`: es el patrón que PublicacionesPage ya resolvió,
                    y es lo único que hace que el detalle se pueda abrir con el
                    teclado. `aria-expanded` anuncia el estado.
                  -->
                  <button
                    class="abrir"
                    type="button"
                    :aria-expanded="abiertas.has(f.personaId)"
                    :aria-label="`Ver las unidades de ${f.nombre}`"
                    @click="alternar(f.personaId)"
                  >
                    <span class="flecha" :class="{ abierta: abiertas.has(f.personaId) }">›</span>
                    {{ f.nombre }}
                  </button>
                  <div v-if="atraso(f)" class="atraso">
                    <StatusChip :texto="atraso(f)!.texto" :tono="atraso(f)!.tono" />
                  </div>
                </td>
                <td class="num">{{ f.unidades.length }}</td>
                <td class="num">{{ f.administradas }}</td>
                <td>
                  <!--
                    ⚠️ Una línea POR MONEDA. La unique de `liquidacion` es
                    (tenant, propietario, período, moneda): un propietario con
                    una unidad en pesos y otra en dólares tiene DOS últimas
                    liquidaciones del mismo mes, y colapsarlas a un número sería
                    un monto sin moneda.
                  -->
                  <div v-if="f.ultimasLiquidaciones.length" class="apilado">
                    <div v-for="l in f.ultimasLiquidaciones" :key="l.moneda" class="liq">
                      <span class="chico">{{ periodo(l.periodo) }}</span>
                      <StatusChip
                        :texto="ETIQUETA_ESTADO_LIQ[l.estado] ?? l.estado"
                        :tono="TONO_ESTADO_LIQ[l.estado] ?? 'neutro'"
                      />
                      <span class="mono">{{ moneyCorto(l.neto, l.moneda) }}</span>
                    </div>
                  </div>
                  <span v-else class="muted">Nunca se le liquidó</span>
                </td>
                <td class="num">
                  <div v-if="f.pendiente.length" class="apilado">
                    <span v-for="p in f.pendiente" :key="p.moneda" class="mono">
                      {{ moneyCorto(p.monto, p.moneda) }}
                    </span>
                  </div>
                  <span v-else class="muted">—</span>
                </td>
                <td>
                  <RouterLink v-if="f.tieneAcceso" class="chico" to="/liquidaciones">
                    Con acceso
                  </RouterLink>
                  <span v-else class="muted chico">Sin acceso</span>
                </td>
              </tr>

              <tr v-if="abiertas.has(f.personaId)" class="detalle">
                <td colspan="6">
                  <ul class="unidades">
                    <li v-for="u in f.unidades" :key="u.id">
                      <RouterLink :to="`/propiedades/${u.id}`" class="mono">{{ u.etiqueta }}</RouterLink>
                      <span>{{ u.direccion }}</span>
                      <!-- El % sólo cuando NO es 100: repetir «100%» en cada
                           unidad tapa justo el 50% que importa. -->
                      <StatusChip v-if="u.porcentaje !== null" :texto="`${u.porcentaje}%`" tono="acento" />
                      <StatusChip v-if="u.administrada" texto="Administrada" tono="ok" />
                    </li>
                    <li v-if="!f.unidades.length" class="muted">Sin unidades cargadas.</li>
                  </ul>
                </td>
              </tr>
            </template>
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
      sustantivo="propietarios"
    />
  </div>
</template>

<style scoped>
.filtros { display: flex; gap: var(--s-md); align-items: center; flex-wrap: wrap; }
.filtros > :first-child { flex: 1; min-width: 220px; }
.apilado { display: flex; flex-direction: column; gap: 2px; }
.liq { display: flex; gap: var(--s-xs); align-items: center; flex-wrap: wrap; }
.chico { font-size: 12px; color: var(--muted); }
.muted { color: var(--muted-2); }
.num { text-align: right; }
.atraso { margin-top: 4px; }

.abrir {
  display: inline-flex; align-items: center; gap: 6px;
  border: 0; background: transparent; font: inherit; font-weight: 500;
  color: var(--ink); padding: 0; cursor: pointer; text-align: left;
}
.abrir:hover { color: var(--accent-ink); }
.flecha { display: inline-block; transition: transform var(--t-micro); color: var(--muted); }
.flecha.abierta { transform: rotate(90deg); }

.detalle td { background: var(--surface-2); }
.unidades { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-xs); }
.unidades li { display: flex; gap: var(--s-sm); align-items: center; flex-wrap: wrap; }
</style>
