<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import PageHeader from '../componentes/PageHeader.vue';
import SearchInput from '../componentes/SearchInput.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiPager from '../componentes/UiPager.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha, money } from '../dominio/formato';
import { consulta, type Pagina } from '../dominio/pagina';
import { laCasa } from '../dominio/vocabulario';

/**
 * Gastos.
 *
 * Hasta la migración 016 un gasto sólo existía como línea de una liquidación:
 * nacía adentro de la rendición del mes. Ahora vive por su cuenta y **la
 * liquidación lo toma**, que es lo que hace posible cargar una reparación en
 * marzo y rendirla en abril — y lo que impide que rearmar la liquidación lo
 * destruya, como pasó una vez con un termotanque de ARS 85.000.
 *
 * Dos cosas que la pantalla tiene que dejar claras de un vistazo, porque son
 * las que generan la discusión:
 *
 *   · **Quién lo paga.** Sólo los del propietario se le descuentan; los del
 *     inquilino se le cobran a él y los de la inmobiliaria no salen de ningún
 *     lado. Va como columna, no escondido en un detalle.
 *   · **Si ya se rindió.** Un gasto rendido es inmutable, y la pantalla no
 *     ofrece editarlo en vez de ofrecerlo y después fallar.
 *
 * Los totales van por moneda y al pie de la tabla: sumar ARS y USD da un número
 * que no significa nada, y salir a Excel para saber cuánto se gastó este mes es
 * exactamente contra lo que compite este producto.
 */

interface Gasto {
  id: string;
  propiedad: { id: string; etiqueta: string; direccion: string };
  contratoId: string | null;
  proveedor: { id: string; nombre: string } | null;
  reclamoId: string | null;
  concepto: string;
  tipo: string;
  monto: number;
  moneda: string;
  fecha: string;
  aCargoDe: string;
  estado: string;
  comprobante: string | null;
  liquidacionId: string | null;
  registradoPor: string | null;
}

const auth = useAuth();

const TIPO: Record<string, string> = {
  reparacion: 'Reparación', impuesto: 'Impuesto', expensas: 'Expensas',
  servicio: 'Servicio', seguro: 'Seguro', otro: 'Otro',
};
const A_CARGO: Record<string, string> = {
  propietario: 'Propietario', inquilino: 'Inquilino', inmobiliaria: 'Inmobiliaria',
};
const ESTADO: Record<string, string> = {
  registrado: 'Por rendir', rendido: 'Rendido', anulado: 'Anulado',
};
const TONO_ESTADO: Record<string, 'ok' | 'warn' | 'err' | 'neutro'> = {
  registrado: 'warn', rendido: 'ok', anulado: 'neutro',
};

const POR_PAGINA = 25;

const ui = useUi();

const items = ref<Gasto[]>([]);
const total = ref(0);
const paginas = ref(1);
const pagina = ref(1);
const cargando = ref(true);
const error = ref('');

const q = ref('');
const filtroEstado = ref('');
const filtroACargo = ref('');
const filtroTipo = ref('');

const nuevo = ref(false);
const guardando = ref(false);
const propiedades = ref<Array<{ id: string; etiqueta: string; direccion: string }>>([]);
const proveedores = ref<Array<{ id: string; nombre: string }>>([]);
const form = ref({
  propiedadId: '', proveedorId: '', concepto: '', tipo: 'reparacion',
  monto: '', moneda: 'ARS', fecha: '', aCargoDe: 'propietario', comprobante: '',
});

/**
 * Totales por moneda de la página que se está mirando.
 *
 * Se aclara "de esta página" y no se finge un total de la cartera: mostrar la
 * suma de 25 filas como si fuera el total del período sería un número falso, y
 * es de las cosas que este producto no hace.
 */
const totales = computed(() => {
  const m = new Map<string, number>();
  for (const g of items.value) {
    if (g.estado === 'anulado') continue;
    m.set(g.moneda, (m.get(g.moneda) ?? 0) + g.monto);
  }
  return [...m.entries()].map(([moneda, monto]) => ({ moneda, monto }))
    .sort((a, b) => a.moneda.localeCompare(b.moneda));
});

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    const r = await api<Pagina<Gasto>>(
      `/gastos?${consulta(
        { pagina: pagina.value, porPagina: POR_PAGINA },
        {
          q: q.value.trim(),
          estado: filtroEstado.value,
          aCargoDe: filtroACargo.value,
          tipo: filtroTipo.value,
        },
      )}`,
    );
    items.value = r.items;
    total.value = r.total;
    paginas.value = r.paginas;
  } catch (e) {
    items.value = [];
    total.value = 0;
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los gastos.';
  } finally {
    cargando.value = false;
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
watch([q, filtroEstado, filtroACargo, filtroTipo], () => {
  clearTimeout(debounce);
  pagina.value = 1;
  debounce = setTimeout(cargar, 220);
});
watch(pagina, () => void cargar());
onMounted(cargar);

async function abrirNuevo() {
  nuevo.value = !nuevo.value;
  if (!nuevo.value || propiedades.value.length) return;
  try {
    const [p, pv] = await Promise.all([
      api<Pagina<{ id: string; etiqueta: string; direccion: string }>>('/propiedades?porPagina=100'),
      api<Pagina<{ id: string; nombre: string }>>('/proveedores?porPagina=100'),
    ]);
    propiedades.value = p.items;
    proveedores.value = pv.items;
  } catch {
    propiedades.value = [];
    proveedores.value = [];
  }
}

async function crear() {
  const monto = Number(form.value.monto);
  if (!form.value.propiedadId || !form.value.concepto.trim() || !(monto > 0)) {
    ui.error('Faltan datos', 'La propiedad, el concepto y un monto mayor a cero son obligatorios.');
    return;
  }
  guardando.value = true;
  try {
    await api('/gastos', {
      method: 'POST',
      body: JSON.stringify({
        propiedadId: form.value.propiedadId,
        concepto: form.value.concepto.trim(),
        tipo: form.value.tipo,
        monto,
        moneda: form.value.moneda,
        aCargoDe: form.value.aCargoDe,
        ...(form.value.proveedorId ? { proveedorId: form.value.proveedorId } : {}),
        ...(form.value.fecha ? { fecha: form.value.fecha } : {}),
        ...(form.value.comprobante.trim() ? { comprobante: form.value.comprobante.trim() } : {}),
      }),
    });
    ui.ok(
      'Gasto cargado',
      form.value.aCargoDe === 'propietario'
        ? 'Entra en la próxima liquidación del propietario.'
        : 'No se le descuenta al propietario.',
    );
    nuevo.value = false;
    form.value = {
      propiedadId: '', proveedorId: '', concepto: '', tipo: 'reparacion',
      monto: '', moneda: 'ARS', fecha: '', aCargoDe: 'propietario', comprobante: '',
    };
    await cargar();
  } catch (e) {
    ui.error('No se pudo cargar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally {
    guardando.value = false;
  }
}

async function anular(g: Gasto) {
  const ok = await ui.confirmar({
    titulo: '¿Anular el gasto?',
    detalle:
      `${g.concepto} · ${money(g.monto, g.moneda)}. Queda registrado como anulado ` +
      'para que se vea que existió; no se borra.',
    confirmar: 'Anular',
    peligroso: true,
  });
  if (!ok) return;

  try {
    await api(`/gastos/${g.id}/anular`, { method: 'POST' });
    ui.ok('Gasto anulado', 'Ya no entra en ninguna liquidación.');
    await cargar();
  } catch (e) {
    ui.error('No se pudo anular', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  }
}
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Gastos"
      :bajada="cargando || error ? '' : `${total} ${total === 1 ? 'gasto' : 'gastos'}`"
    >
      <template #acciones>
        <button class="btn" type="button" @click="abrirNuevo">
          {{ nuevo ? 'Cancelar' : 'Nuevo gasto' }}
        </button>
      </template>
    </PageHeader>

    <p v-if="error" class="alert con-accion" role="alert">
      <span>{{ error }}</span>
      <button class="btn secondary sm" type="button" @click="cargar()">Reintentar</button>
    </p>

    <form v-if="nuevo" class="card pad-sm alta" @submit.prevent="crear">
      <h2 class="text-lg">Nuevo gasto</h2>
      <div class="grilla">
        <label class="campo">
          <span>Propiedad</span>
          <select v-model="form.propiedadId" required>
            <option value="" disabled>Elegí una</option>
            <option v-for="p in propiedades" :key="p.id" :value="p.id">
              {{ p.etiqueta }} · {{ p.direccion }}
            </option>
          </select>
        </label>
        <label class="campo">
          <span>Tipo</span>
          <select v-model="form.tipo">
            <option v-for="(t, k) in TIPO" :key="k" :value="k">{{ t }}</option>
          </select>
        </label>
        <label class="campo">
          <span>Quién lo paga</span>
          <select v-model="form.aCargoDe">
            <option v-for="(t, k) in A_CARGO" :key="k" :value="k">{{ t }}</option>
          </select>
        </label>
        <label class="campo">
          <span>Proveedor <em>(opcional)</em></span>
          <select v-model="form.proveedorId">
            <option value="">Sin proveedor</option>
            <option v-for="p in proveedores" :key="p.id" :value="p.id">{{ p.nombre }}</option>
          </select>
        </label>
        <label class="campo">
          <span>Monto</span>
          <input v-model="form.monto" inputmode="decimal" placeholder="0,00" required />
        </label>
        <label class="campo">
          <span>Moneda</span>
          <select v-model="form.moneda">
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label class="campo">
          <span>Fecha</span>
          <input v-model="form.fecha" type="date" />
        </label>
        <label class="campo">
          <span>Comprobante</span>
          <input v-model="form.comprobante" placeholder="FC-A-0001" />
        </label>
      </div>
      <label class="campo">
        <span>Concepto</span>
        <input v-model="form.concepto" placeholder="Cambio de termotanque" required />
      </label>
      <p class="ayuda">
        <template v-if="form.aCargoDe === 'propietario'">
          Se le descuenta al propietario en la próxima liquidación del período.
        </template>
        <template v-else-if="form.aCargoDe === 'inquilino'">
          No entra en la liquidación: se le cobra al inquilino.
        </template>
        <template v-else>
          Lo absorbe {{ laCasa(auth.tipoCuenta) }}. No entra en ninguna liquidación.
        </template>
      </p>
      <div class="pie">
        <button class="btn secondary" type="button" @click="nuevo = false">Cancelar</button>
        <button class="btn" type="submit" :disabled="guardando">
          {{ guardando ? 'Guardando…' : 'Cargar el gasto' }}
        </button>
      </div>
    </form>

    <div class="filtros">
      <SearchInput v-model="q" placeholder="Concepto o proveedor…" />
      <label class="campo suave">
        <span>Estado</span>
        <select v-model="filtroEstado">
          <option value="">Todos</option>
          <option v-for="(t, k) in ESTADO" :key="k" :value="k">{{ t }}</option>
        </select>
      </label>
      <label class="campo suave">
        <span>Quién paga</span>
        <select v-model="filtroACargo">
          <option value="">Todos</option>
          <option v-for="(t, k) in A_CARGO" :key="k" :value="k">{{ t }}</option>
        </select>
      </label>
      <label class="campo suave">
        <span>Tipo</span>
        <select v-model="filtroTipo">
          <option value="">Todos</option>
          <option v-for="(t, k) in TIPO" :key="k" :value="k">{{ t }}</option>
        </select>
      </label>
    </div>

    <UiSkeleton v-if="cargando" :filas="5" :alto="48" />

    <UiEmpty
      v-else-if="!error && !items.length"
      titulo="Sin gastos"
      detalle="Una reparación, un impuesto o una expensa adelantada se cargan acá y entran solos en la liquidación del propietario."
    >
      <button class="btn" type="button" @click="abrirNuevo">Cargar el primero</button>
    </UiEmpty>

    <div v-else-if="items.length" class="card sin-padding">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Propiedad</th>
            <th>Concepto</th>
            <th class="secundaria">Tipo</th>
            <th>Paga</th>
            <th class="num">Monto</th>
            <th>Estado</th>
            <th class="acciones"><span class="visually-hidden">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in items" :key="g.id" :class="{ anulado: g.estado === 'anulado' }">
            <td class="mono nowrap">{{ fecha(g.fecha) }}</td>
            <td>
              <span class="mono cod">{{ g.propiedad.etiqueta }}</span>
              <span class="dir">{{ g.propiedad.direccion }}</span>
            </td>
            <td>
              <span class="conc">{{ g.concepto }}</span>
              <span v-if="g.proveedor || g.comprobante" class="sub">
                {{ g.proveedor?.nombre ?? '' }}
                <template v-if="g.proveedor && g.comprobante"> · </template>
                <span v-if="g.comprobante" class="mono">{{ g.comprobante }}</span>
              </span>
            </td>
            <td class="secundaria">{{ TIPO[g.tipo] ?? g.tipo }}</td>
            <td>{{ A_CARGO[g.aCargoDe] }}</td>
            <td class="num">{{ money(g.monto, g.moneda) }}</td>
            <td><StatusChip :texto="ESTADO[g.estado]" :tono="TONO_ESTADO[g.estado]" /></td>
            <td class="acciones">
              <!-- Un gasto rendido es inmutable: no se ofrece anularlo para
                   después fallar. Un control que no va a funcionar es peor que
                   la ausencia del control. -->
              <button
                v-if="g.estado === 'registrado'"
                class="btn secondary sm"
                type="button"
                @click="anular(g)"
              >
                Anular
              </button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5" class="pie-tot">Total de esta página, sin los anulados</td>
            <td class="num">
              <span v-for="t in totales" :key="t.moneda" class="tot">
                {{ money(t.monto, t.moneda) }}
              </span>
              <span v-if="!totales.length">—</span>
            </td>
            <td colspan="2" />
          </tr>
        </tfoot>
      </table>
    </div>

    <UiPager
      v-if="paginas > 1"
      v-model:pagina="pagina"
      :paginas="paginas"
      :total="total"
      :por-pagina="POR_PAGINA"
      sustantivo="gastos"
    />
  </div>
</template>

<style scoped>
.cod { display: block; font-size: 11px; color: var(--muted); }
.dir { font-size: 13px; }
.conc { display: block; color: var(--ink); }
.sub { display: block; font-size: 11px; color: var(--muted); }
.nowrap { white-space: nowrap; }
tr.anulado td { opacity: .55; text-decoration: line-through; }
tr.anulado .acciones { text-decoration: none; }

tfoot td {
  border-top: 1px solid var(--line-strong);
  border-bottom: none;
  background: var(--surface-2);
  font-weight: 500;
}
.pie-tot { text-align: right; font-size: 12px; color: var(--muted); font-weight: 400; }
.tot { display: block; color: var(--ink); }

.alta { display: flex; flex-direction: column; gap: var(--s-md); }
.alta h2 { margin: 0; }
.grilla {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: var(--s-md);
}
.ayuda { margin: 0; font-size: 12px; color: var(--muted); }
.pie { display: flex; justify-content: flex-end; gap: var(--s-sm); }

/* Tipo se va en pantalla angosta: el concepto ya lo dice con palabras. */
@media (max-width: 760px) {
  .secundaria { display: none; }
}
</style>
