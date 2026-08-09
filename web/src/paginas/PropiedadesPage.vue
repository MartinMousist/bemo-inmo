<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError, descargar } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import { pct } from '../dominio/comisiones';
import PageHeader from '../componentes/PageHeader.vue';
import PanelMapas from '../componentes/PanelMapas.vue';
import SearchInput from '../componentes/SearchInput.vue';
import SelectAgente from '../componentes/SelectAgente.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import {
  ETIQUETA_ESTADO_OP,
  ETIQUETA_OPERACION,
  ETIQUETA_TIPO,
  moneyCorto,
  numero,
} from '../dominio/formato';
import { hayFiltroDeAgente, paramsDeAgente } from '../dominio/agente';
import { filtrosRecordados } from '../dominio/filtros';

interface Operacion {
  id: string;
  tipo: string;
  precio: number | null;
  moneda: string;
  estado: string;
  /**
   * Los honorarios que cobra ESTA operación, ya resueltos.
   *
   * `propio: false` significa que el número es el de la inmobiliaria y no de
   * esta propiedad. Sin esa distinción, un 6 % en la fila no dice si alguien lo
   * eligió para este inmueble o si es el default de la casa — y son cosas
   * distintas a la hora de cambiarlo.
   */
  comision: { puntas: Record<string, number>; total: number; propio: boolean } | null;
}

interface Propiedad {
  id: string;
  etiqueta: string;
  direccion: string;
  tipo: string;
  ambientes: number | null;
  supTotal: number | null;
  ubicacionConocida: boolean;
  agenteCaptador: { id: string; nombre: string } | null;
  operaciones: Operacion[];
}

const router = useRouter();
const auth = useAuth();
const ui = useUi();

/**
 * Cuánto cobra la inmobiliaria por vender o alquilar esto es política
 * comercial: el precio lo carga cualquiera, el honorario no. Mismo recorte que
 * el PUT de la política de comisiones.
 */
const puedeEditarComision = computed(() => auth.rol === 'owner' || auth.rol === 'admin');

/** `propiedadId:operacionId` de la operación que se está editando. */
const editando = ref<string | null>(null);
const borrador = ref({ a: '', b: '' });
const guardando = ref(false);

/**
 * Las dos puntas de la operación, en el orden en que se escriben.
 *
 * Se editan por SEPARADO y no como un total acoplado: la pantalla de Comisiones
 * acopla porque ahí se define la política general, pero acá el caso real es
 * «a este dueño le cobramos 4 y al comprador 2», que con un total acoplado no
 * se puede expresar.
 */
function puntasDe(o: Operacion): Array<{ clave: string; etiqueta: string; valor: number }> {
  const p = o.comision?.puntas ?? {};
  return o.tipo === 'venta'
    ? [
        { clave: 'compradora', etiqueta: 'compradora', valor: p.compradora ?? 0 },
        { clave: 'vendedora', etiqueta: 'vendedora', valor: p.vendedora ?? 0 },
      ]
    : [
        { clave: 'locataria', etiqueta: 'locataria', valor: p.locataria ?? 0 },
        { clave: 'locadora', etiqueta: 'locadora', valor: p.locadora ?? 0 },
      ];
}

function abrirComision(p: Propiedad, o: Operacion) {
  editando.value = `${p.id}:${o.id}`;
  const [a, b] = puntasDe(o);
  borrador.value = { a: String(a.valor), b: String(b.valor) };
}

const borradorExcede = computed(
  () => Number(borrador.value.a || 0) + Number(borrador.value.b || 0) > 100,
);

async function guardarComision(p: Propiedad, o: Operacion) {
  guardando.value = true; error.value = '';
  try {
    const cuerpo = o.tipo === 'venta'
      ? { venta: { compradora: Number(borrador.value.a), vendedora: Number(borrador.value.b) } }
      : { alquiler: { locataria: Number(borrador.value.a), locadora: Number(borrador.value.b) } };

    await api(`/propiedades/${p.id}/operaciones/${o.id}/comisiones`, {
      method: 'PATCH',
      body: JSON.stringify(cuerpo),
    });
    editando.value = null;
    await cargar();
    ui.ok('Honorarios guardados', `${p.etiqueta} · sólo afecta a esta operación.`);
  } catch (e) {
    const detalle = e instanceof ApiError ? e.paraMostrar : 'No se pudo guardar.';
    error.value = detalle;
    ui.error('No se pudieron guardar los honorarios', detalle);
  } finally { guardando.value = false; }
}

/**
 * Vuelve a heredar de la inmobiliaria: se manda `{}` y la operación deja de
 * tener número propio. No es lo mismo que poner cero — cero es «esta propiedad
 * no cobra honorarios».
 */
async function heredarComision(p: Propiedad, o: Operacion) {
  guardando.value = true; error.value = '';
  try {
    await api(`/propiedades/${p.id}/operaciones/${o.id}/comisiones`, {
      method: 'PATCH',
      body: '{}',
    });
    editando.value = null;
    await cargar();
    ui.ok('Vuelve a heredar', `${p.etiqueta} usa de nuevo los honorarios de la casa.`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo volver a heredar.';
  } finally { guardando.value = false; }
}
const items = ref<Propiedad[]>([]);
const total = ref(0);
const pagina = ref(1);
const paginas = ref(1);
const q = ref('');
const filtroOperacion = ref('');
const cargando = ref(true);
const error = ref('');

/**
 * El filtro por agente se recuerda; la búsqueda no.
 *
 * Se guarda el centinela `'yo'` y no el uuid: la PC del mostrador se comparte y
 * guardar el uuid haría que la segunda persona abra Propiedades filtrada por la
 * primera y vea una lista vacía sin entender por qué. Ver `dominio/agente.ts`.
 */
const { valores: filtros } = filtrosRecordados('propiedades', { agente: '' });

const hayFiltro = computed(
  () => !!q.value || !!filtroOperacion.value || hayFiltroDeAgente(filtros.value.agente),
);

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({
      pagina: String(pagina.value),
      porPagina: '25',
    });
    if (q.value.trim()) params.set('q', q.value.trim());
    if (filtroOperacion.value) params.set('operacion', filtroOperacion.value);
    for (const [k, v] of Object.entries(paramsDeAgente(filtros.value.agente, auth.usuario?.id ?? null))) {
      if (v !== undefined) params.set(k, v);
    }

    const r = await api<{ items: Propiedad[]; total: number; paginas: number }>(
      `/propiedades?${params}`,
    );
    items.value = r.items;
    total.value = r.total;
    paginas.value = r.paginas;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar las propiedades.';
  } finally {
    cargando.value = false;
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
watch([q, filtroOperacion, filtros], () => {
  clearTimeout(debounce);
  pagina.value = 1;
  debounce = setTimeout(cargar, 220);
}, { deep: true });
watch(pagina, () => void cargar());

function tono(estado: string) {
  if (estado === 'disponible') return 'ok' as const;
  if (estado === 'reservada') return 'warn' as const;
  if (estado === 'cerrada' || estado === 'suspendida') return 'err' as const;
  return 'neutro' as const;
}

async function exportar() {
  error.value = '';
  try { await descargar('/exportar/propiedades.csv'); }
  catch (e) { error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo exportar.'; }
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Propiedades"
      :bajada="cargando ? '' : `${total} en cartera`"
    >
      <template #acciones>
        <button class="btn secondary" type="button" @click="exportar">Exportar</button>
        <RouterLink class="btn" to="/propiedades/nueva">Nueva propiedad</RouterLink>
      </template>
    </PageHeader>

    <!-- Sólo aparece si hay algo que hacer con los mapas: falta la key, la key
         no responde, o quedaron propiedades sin ubicar. -->
    <PanelMapas @sincronizado="cargar" />

    <div class="filtros">
      <SearchInput v-model="q" placeholder="Dirección, localidad o código…" />
      <div class="segmented">
        <button
          v-for="op in [
            { v: '', t: 'Todas' },
            { v: 'venta', t: 'Venta' },
            { v: 'alquiler', t: 'Alquiler' },
          ]"
          :key="op.v"
          type="button"
          :class="{ activo: filtroOperacion === op.v }"
          @click="filtroOperacion = op.v"
        >
          {{ op.t }}
        </button>
      </div>

      <SelectAgente v-model="filtros.agente" etiqueta="Captó" con-sin-asignar />
    </div>

    <!-- «Exportar» baja SIEMPRE la cartera completa: `GET /exportar/:recurso.csv`
         no toma ningún filtro. Con una lista filtrada al lado, quien apreta cree
         que se está bajando lo que ve. Se dice, en vez de sacar el botón: bajar
         todo sigue siendo lo que la mayoría quiere. -->
    <p v-if="hayFiltro" class="aviso-exportar">
      El botón «Exportar» baja la cartera completa, no lo que está filtrado.
    </p>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="card sin-padding">
      <UiSkeleton v-if="cargando" :filas="5" />

      <UiEmpty
        v-else-if="!items.length"
        :titulo="hayFiltro ? 'Ninguna propiedad coincide' : 'Todavía no hay propiedades'"
        :detalle="
          hayFiltro
            ? 'Probá con otra búsqueda o quitá los filtros.'
            : 'Cargá la primera y quedará disponible para publicar y para asociar a una operación.'
        "
      >
        <RouterLink v-if="!hayFiltro" class="btn" to="/propiedades/nueva">
          Cargar la primera
        </RouterLink>
        <button
          v-else class="btn secondary" type="button"
          @click="q = ''; filtroOperacion = ''; filtros.agente = ''"
        >
          Quitar filtros
        </button>
      </UiEmpty>

      <!-- SIN `.table-wrap`, a propósito: era incompatible con `table-sticky` y
           le tapaba la primera fila (ver el comentario en `familia.css`). Lo
           que el scroll horizontal resolvía —seis columnas en un teléfono— se
           resuelve ocultando las tres secundarias abajo de 760px, que es lo
           que ya hace Vencimientos. Scrollear de costado una tabla escondía la
           columna Estado sin avisar; ocultarla es la misma pérdida, dicha. -->
      <div v-else>
        <!-- `table-sticky`: la cartera es larga y el encabezado tiene que
             quedar a la vista. Se ancla abajo de la topbar, que también es
             pegada; con `top: 0` quedaba tapado por ella. -->
        <table class="table-sticky table-clicable">
          <thead>
            <tr>
              <th>Código</th>
              <th>Dirección</th>
              <th class="secundaria">Tipo</th>
              <th class="der secundaria">Amb.</th>
              <th class="der secundaria">m²</th>
              <th class="secundaria">Captó</th>
              <th>Operaciones</th>
              <th class="secundaria">Honorarios</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in items"
              :key="p.id"
              tabindex="0"
              @click="router.push(`/propiedades/${p.id}`)"
              @keydown.enter="router.push(`/propiedades/${p.id}`)"
            >
              <td class="mono cod">{{ p.etiqueta }}</td>
              <td>
                <span class="dir">{{ p.direccion }}</span>
                <span v-if="!p.ubicacionConocida" class="sin-ubi" title="Sin ubicación en el mapa">
                  sin ubicar
                </span>
              </td>
              <td class="secundaria">{{ ETIQUETA_TIPO[p.tipo] ?? p.tipo }}</td>
              <td class="der mono secundaria">{{ numero(p.ambientes) }}</td>
              <td class="der mono secundaria">{{ numero(p.supTotal) }}</td>
              <td class="secundaria">
                <span v-if="p.agenteCaptador" class="captador">{{ p.agenteCaptador.nombre }}</span>
                <span v-else class="muted">sin captador</span>
              </td>
              <td>
                <div class="ops">
                  <span v-for="o in p.operaciones" :key="o.id" class="op">
                    <StatusChip :texto="ETIQUETA_OPERACION[o.tipo] ?? o.tipo" tono="acento" />
                    <span class="mono precio">{{ moneyCorto(o.precio, o.moneda) }}</span>
                    <StatusChip :texto="ETIQUETA_ESTADO_OP[o.estado] ?? o.estado" :tono="tono(o.estado)" />
                  </span>
                  <span v-if="!p.operaciones.length" class="muted">Sin operación</span>
                </div>
              </td>

              <!-- Los honorarios, editables en la fila.
                   `@click.stop` y `@keydown.stop` en TODO lo interactivo: la fila
                   entera navega a la ficha, así que sin esto tocar el input abre
                   la propiedad, y con el teclado el Enter que confirma el valor
                   la abre también. -->
              <td class="hon secundaria" @click.stop @keydown.stop>
                <div class="ops">
                  <template v-for="o in p.operaciones" :key="o.id">
                    <div v-if="editando === `${p.id}:${o.id}`" class="editor">
                      <label class="mini">
                        <span>{{ puntasDe(o)[0].etiqueta }}</span>
                        <input
                          v-model="borrador.a" class="pct" inputmode="decimal"
                          :aria-label="`Punta ${puntasDe(o)[0].etiqueta}`"
                          @keydown.enter.prevent="guardarComision(p, o)"
                          @keydown.esc="editando = null" />
                      </label>
                      <label class="mini">
                        <span>{{ puntasDe(o)[1].etiqueta }}</span>
                        <input
                          v-model="borrador.b" class="pct" inputmode="decimal"
                          :aria-label="`Punta ${puntasDe(o)[1].etiqueta}`"
                          @keydown.enter.prevent="guardarComision(p, o)"
                          @keydown.esc="editando = null" />
                      </label>
                      <button class="btn sm" type="button"
                              :disabled="guardando || borradorExcede"
                              @click="guardarComision(p, o)">OK</button>
                      <button class="btn secondary sm" type="button"
                              @click="editando = null">Cancelar</button>
                      <button v-if="o.comision?.propio" class="btn secondary sm" type="button"
                              :disabled="guardando" @click="heredarComision(p, o)">
                        Volver a heredar
                      </button>
                    </div>

                    <div v-else class="op">
                      <span class="mono total">{{ pct(o.comision?.total ?? 0) }}</span>
                      <span class="detalle">
                        {{ puntasDe(o).map((x) => `${x.etiqueta} ${x.valor}`).join(' + ') }}
                      </span>
                      <span class="origen" :class="{ propio: o.comision?.propio }">
                        {{ o.comision?.propio ? 'de esta propiedad' : 'de la casa' }}
                      </span>
                      <button
                        v-if="puedeEditarComision" class="btn secondary sm" type="button"
                        @click="abrirComision(p, o)">
                        Cambiar
                      </button>
                    </div>
                  </template>
                  <span v-if="!p.operaciones.length" class="muted">—</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="paginas > 1" class="pager">
      <button class="btn secondary sm" :disabled="pagina === 1" @click="pagina--">Anterior</button>
      <span class="mono">{{ pagina }} / {{ paginas }}</span>
      <button class="btn secondary sm" :disabled="pagina === paginas" @click="pagina++">
        Siguiente
      </button>
    </div>
  </div>
</template>

<style scoped>

td {
  padding: var(--s-md) var(--s-lg);
  border-bottom: 1px solid var(--line);
  color: var(--ink-2);
  vertical-align: middle;
}
.cod { color: var(--muted); white-space: nowrap; }
.dir { color: var(--ink); }
.sin-ubi {
  margin-left: var(--s-sm);
  font-size: 11px;
  color: var(--warning);
}
.ops { display: flex; flex-direction: column; gap: var(--s-xs); }
.op { display: inline-flex; align-items: center; gap: var(--s-sm); }
.precio { font-size: 12px; color: var(--ink); }
.muted { color: var(--muted-2); font-size: 12px; }
.captador { font-size: 12px; color: var(--ink-2); }
.aviso-exportar { margin: 0; font-size: 12px; color: var(--muted); }
.hon .op { flex-wrap: wrap; row-gap: var(--s-2xs); }
.total { font-size: 13px; color: var(--ink); }
.detalle { font-size: 11px; color: var(--muted); }
.origen { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted-2); }
.origen.propio { color: var(--accent-ink); }
.editor { display: flex; align-items: flex-end; gap: var(--s-sm); flex-wrap: wrap; }
.mini { display: flex; flex-direction: column; gap: 2px; }
.mini > span { font-size: 10px; color: var(--muted-2); }
.pct {
  width: 6ch; font: inherit; font-size: 12px; text-align: right;
  padding: 2px var(--s-sm); border: 1px solid var(--line-strong);
  border-radius: var(--r-sm); background: var(--surface); color: var(--ink);
}

/* Tipo, ambientes, m², captador y honorarios se van en pantalla angosta: son el
   detalle de la ficha, no lo que se busca en un listado. Lo que queda —código,
   dirección y las operaciones con su precio— es lo que identifica una propiedad.

   Los honorarios se esconden y NO se dejan cortados: con siete columnas la
   última queda fuera del ancho, y la tarjeta recorta con `clip`, así que no se
   podría ni scrollear hasta ella — el editor existiría y sería inalcanzable.
   El mismo control está en la ficha de la propiedad, que es donde se edita
   desde un teléfono. Ocultarla es una pérdida; dejarla cortada es un defecto. */
@media (max-width: 760px) {
  .secundaria { display: none; }

  /* Y con tres columnas la de operaciones sigue sin entrar en 375px: tipo,
     precio y estado en una línea son ~200px. Se apilan. Sin esto el chip de
     estado quedaba cortado por el borde de la tarjeta, que ahora recorta con
     `clip` y por lo tanto ni siquiera deja scrollear hasta él. */
  .op { flex-wrap: wrap; row-gap: var(--s-2xs); }
  td { padding: var(--s-md) var(--s-sm); }
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-lg);
  font-size: 13px;
  color: var(--muted);
}

</style>
