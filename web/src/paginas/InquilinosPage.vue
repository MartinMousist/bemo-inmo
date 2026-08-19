<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import EnlacePropietario from '../componentes/EnlacePropietario.vue';
import { fecha, moneyCorto, numero } from '../dominio/formato';
import { filtrosRecordados } from '../dominio/filtros';
import PageHeader from '../componentes/PageHeader.vue';
import SearchInput from '../componentes/SearchInput.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiPager from '../componentes/UiPager.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';

interface FilaInquilino {
  contratoId: string;
  inquilino: { id: string; nombre: string } | null;
  coInquilinos: string[];
  propiedad: { id: string; etiqueta: string; direccion: string };
  desde: string; hasta: string; estado: string; vigente: boolean;
  alquilerVigente: number; moneda: string;
  cobranza: 'al_dia' | 'parcial' | 'en_mora' | 'sin_cuotas';
  saldo: number; diasDeMora: number; moraDesde: string | null;
  proximoAjuste: { vigenteDesde: string; estado: string } | null;
  garantes: { cargados: number; minimo: number };
}

const COBRANZAS = ['al_dia', 'parcial', 'en_mora', 'sin_cuotas'] as const;

const ETIQUETA_COBRANZA: Record<string, string> = {
  al_dia: 'Al día', parcial: 'Parcial', en_mora: 'En mora', sin_cuotas: 'Sin cuotas',
};

/**
 * El tono del chip de cobranza.
 *
 * `en_mora` va con `err`, que en familia.css es texto sobre un fondo tenue y NO
 * blanco sobre `--danger` sólido: ese combo daba 3,13:1 en tema oscuro y es el
 * defecto B-03 de la etapa 11. El chip `err` de la capa familia ya está medido.
 */
const TONO_COBRANZA: Record<string, 'ok' | 'warn' | 'err' | 'neutro'> = {
  al_dia: 'ok', parcial: 'warn', en_mora: 'err', sin_cuotas: 'neutro',
};

const { valores: filtros } = filtrosRecordados(
  'inquilinos',
  { vigencia: 'vigentes', cobranza: '' },
  { vigencia: ['vigentes', 'todos'], cobranza: COBRANZAS },
);

const items = ref<FilaInquilino[]>([]);
const total = ref(0);
const personasQueAlquilaron = ref<number | null>(null);
const pagina = ref(1);
const porPagina = 25;
const paginas = ref(1);
const q = ref('');
const cargando = ref(true);
const error = ref('');

/**
 * La bajada dice LOS DOS números, y eso no es verborragia.
 *
 * Esta pantalla cuenta CONTRATOS y arranca filtrada en vigentes; la pestaña
 * «Inquilinos» de Personas cuenta PERSONAS que alquilaron alguna vez. Que una
 * diga 12 y la otra 17 es correcto y parece un bug, así que se explica acá
 * antes de que lo pregunten.
 */
const bajada = computed(() => {
  if (cargando.value) return '';
  const contratos = `${total.value} ${filtros.value.vigencia === 'vigentes' ? 'con contrato vigente' : 'contratos'}`;
  if (personasQueAlquilaron.value === null) return contratos;
  return `${contratos} · ${personasQueAlquilaron.value} personas alquilaron alguna vez`;
});

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const p = new URLSearchParams({ pagina: String(pagina.value), porPagina: String(porPagina) });
    if (q.value.trim()) p.set('q', q.value.trim());
    if (filtros.value.vigencia) p.set('vigencia', filtros.value.vigencia);
    if (filtros.value.cobranza) p.set('cobranza', filtros.value.cobranza);

    const r = await api<{
      items: FilaInquilino[]; total: number; paginas: number; personasQueAlquilaron: number;
    }>(`/inquilinos?${p}`);
    items.value = r.items; total.value = r.total; paginas.value = r.paginas;
    personasQueAlquilaron.value = r.personasQueAlquilaron;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los inquilinos.';
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
    <PageHeader titulo="Inquilinos" :bajada="bajada">
      <template #acciones>
        <RouterLink class="btn secondary" to="/personas?rol=inquilino">Ver en Personas</RouterLink>
      </template>
    </PageHeader>

    <div class="filtros">
      <SearchInput v-model="q" placeholder="Inquilino, dirección o código…" />

      <div class="segmented" role="group" aria-label="Vigencia del contrato">
        <button
          type="button"
          :aria-pressed="filtros.vigencia === 'vigentes'"
          @click="filtros.vigencia = 'vigentes'"
        >Vigentes</button>
        <button
          type="button"
          :aria-pressed="filtros.vigencia === 'todos'"
          @click="filtros.vigencia = 'todos'"
        >Todos</button>
      </div>

      <div class="segmented scroll" role="group" aria-label="Estado de cobranza">
        <button type="button" :aria-pressed="!filtros.cobranza" @click="filtros.cobranza = ''">
          Toda la cobranza
        </button>
        <button
          v-for="c in COBRANZAS"
          :key="c"
          type="button"
          :aria-pressed="filtros.cobranza === c"
          @click="filtros.cobranza = c"
        >{{ ETIQUETA_COBRANZA[c] }}</button>
      </div>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="card sin-padding">
      <UiSkeleton v-if="cargando" :filas="6" />
      <UiEmpty
        v-else-if="!items.length"
        :titulo="q ? `Ningún inquilino coincide con «${q}»` : 'No hay inquilinos para ese filtro'"
        detalle="Una persona es inquilina cuando figura como locataria de un contrato de alquiler. Los contratos se cargan desde Contratos."
      >
        <button v-if="q" class="btn secondary" type="button" @click="q = ''">Limpiar la búsqueda</button>
        <RouterLink v-else class="btn" to="/contratos">Ir a Contratos</RouterLink>
      </UiEmpty>

      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Inquilino</th>
              <th>Propiedad</th>
              <th>Contrato</th>
              <th class="num">Alquiler vigente</th>
              <th>Cobranza</th>
              <!--
                «Saldo» y NO «Adeudado», que es lo que decía primero y era
                mentira: el número incluye la cuota del mes que todavía no
                venció. Se vio en la app —Lucía Bianchi, «Al día» con ARS
                712.000 al lado— y es la cuota que vence mañana, no una deuda.
                «Saldo» es además como lo llama la ficha del contrato, que
                muestra exactamente este mismo número.
              -->
              <th class="num">Saldo</th>
              <th class="num">Mora</th>
              <th>Próximo ajuste</th>
              <th class="num">Garantes</th>
              <th><span class="visually-hidden">Portal del inquilino</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in items" :key="f.contratoId">
              <td class="fuerte">
                <RouterLink :to="`/contratos/${f.contratoId}`">
                  {{ f.inquilino?.nombre ?? 'Sin inquilino cargado' }}
                </RouterLink>
                <!-- `bloque`: en línea se pega al apellido del primero. -->
                <span v-if="f.coInquilinos.length" class="chico bloque">
                  y {{ f.coInquilinos.join(', ') }}
                </span>
              </td>
              <td>
                <div class="apilado">
                  <span class="mono">{{ f.propiedad.etiqueta }}</span>
                  <span class="chico">{{ f.propiedad.direccion }}</span>
                </div>
              </td>
              <!-- dd/mm/aaaa, y las fechas llegan como texto AAAA-MM-DD: no
                   pasan por `new Date()` en ningún punto del camino. -->
              <td class="chico">{{ fecha(f.desde) }} → {{ fecha(f.hasta) }}</td>
              <!-- Ningún monto sin su moneda. -->
              <td class="num mono">{{ moneyCorto(f.alquilerVigente, f.moneda) }}</td>
              <td>
                <StatusChip
                  :texto="ETIQUETA_COBRANZA[f.cobranza] ?? f.cobranza"
                  :tono="TONO_COBRANZA[f.cobranza]"
                />
              </td>
              <td class="num mono">
                {{ f.saldo > 0 ? moneyCorto(f.saldo, f.moneda) : '—' }}
              </td>
              <td class="num">
                <span v-if="f.diasDeMora > 0" :title="`Desde el ${fecha(f.moraDesde)}`">
                  {{ numero(f.diasDeMora, ' d') }}
                </span>
                <span v-else class="muted">—</span>
              </td>
              <td class="chico">
                <template v-if="f.proximoAjuste">
                  {{ fecha(f.proximoAjuste.vigenteDesde) }}
                  <span v-if="f.proximoAjuste.estado === 'proyectado'" class="muted">· sin confirmar</span>
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td class="num">
                <!-- n/2, no un número suelto: «1» no dice nada, «1/2» dice que
                     falta uno. El mínimo lo fija el back (MINIMO_GARANTES). -->
                <span :class="{ falta: f.garantes.cargados < f.garantes.minimo }">
                  {{ f.garantes.cargados }}/{{ f.garantes.minimo }}
                </span>
              </td>
              <!-- El enlace del portal. Sólo con inquilino identificado: sin
                   persona no hay a quién dárselo. -->
              <td @click.stop @keydown.stop>
                <EnlacePropietario
                  v-if="f.inquilino"
                  :persona-id="f.inquilino.id"
                  :nombre="f.inquilino.nombre"
                  rol="inquilino"
                />
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
      sustantivo="contratos"
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
/* `--danger-ink` y no blanco sobre `--danger`: ese combo daba 3,13:1 en tema
   oscuro (defecto B-03 de la etapa 11). Medido sobre `--surface`:
   claro #b23a32 → 5,93 · oscuro #d9756c → 5,39. Los dos pasan AA. */
.falta { color: var(--danger-ink); font-weight: 500; }
</style>
