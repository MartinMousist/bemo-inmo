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

/**
 * Reclamos de mantenimiento.
 *
 * Es la carga operativa número uno de un alquiler administrado, y hasta acá
 * vivía en WhatsApp. La pantalla se ordena por lo que hay que atender primero
 * —urgentes arriba, y dentro de cada prioridad los más viejos— porque la
 * pregunta que trae a alguien acá es "¿qué tengo abierto?", no "¿qué pasó?".
 *
 * Resolver abre un panel en la misma fila en vez de navegar: cerrar un reclamo
 * es de a varios por vez y perder el lugar en la lista cada vez lo hace
 * insoportable.
 */

interface Reclamo {
  id: string;
  propiedad: { id: string; etiqueta: string; direccion: string };
  contratoId: string | null;
  categoria: string;
  descripcion: string;
  prioridad: string;
  estado: string;
  aCargoDe: string | null;
  proveedor: { id: string; nombre: string } | null;
  reportadoPor: string | null;
  abiertoPor: string | null;
  resolucion: string | null;
  resueltoEl: string | null;
  gasto: { id: string; monto: number; moneda: string } | null;
  diasAbierto: number;
  creadoEl: string;
}

const CATEGORIA: Record<string, string> = {
  plomeria: 'Plomería', electricidad: 'Electricidad', gas: 'Gas',
  humedad: 'Humedad', cerrajeria: 'Cerrajería', climatizacion: 'Climatización',
  estructura: 'Estructura', artefactos: 'Artefactos', limpieza: 'Limpieza', otro: 'Otro',
};
const PRIORIDAD: Record<string, string> = {
  baja: 'Baja', normal: 'Normal', alta: 'Alta', urgente: 'Urgente',
};
const TONO_PRIORIDAD: Record<string, 'ok' | 'warn' | 'err' | 'neutro'> = {
  baja: 'neutro', normal: 'neutro', alta: 'warn', urgente: 'err',
};
const ESTADO: Record<string, string> = {
  abierto: 'Abierto', en_curso: 'En curso', resuelto: 'Resuelto', cancelado: 'Cancelado',
};
const A_CARGO: Record<string, string> = {
  propietario: 'Propietario', inquilino: 'Inquilino', inmobiliaria: 'Inmobiliaria',
};

const POR_PAGINA = 25;

const auth = useAuth();
const ui = useUi();

const items = ref<Reclamo[]>([]);
const total = ref(0);
const paginas = ref(1);
const pagina = ref(1);
const cargando = ref(true);
const error = ref('');

const q = ref('');
const filtroEstado = ref('');
const filtroPrioridad = ref('');
const soloPendientes = ref(true);

/** Sólo quien puede tocar plata resuelve: resolver puede generar un gasto. */
const puedeResolver = computed(() => auth.rol === 'owner' || auth.rol === 'admin');

/** Fila que tiene abierto el panel de resolución. */
const resolviendo = ref<string | null>(null);
const form = ref({ resolucion: '', monto: '', moneda: 'ARS', comprobante: '' });
const guardando = ref(false);

// ── Alta ────────────────────────────────────────────────────────────────────
const nuevo = ref(false);
const propiedades = ref<Array<{ id: string; etiqueta: string; direccion: string }>>([]);
const formNuevo = ref({
  propiedadId: '', categoria: 'plomeria', prioridad: 'normal',
  aCargoDe: '', descripcion: '',
});

async function abrirNuevo() {
  nuevo.value = !nuevo.value;
  if (!nuevo.value || propiedades.value.length) return;
  try {
    const r = await api<Pagina<{ id: string; etiqueta: string; direccion: string }>>(
      '/propiedades?porPagina=100',
    );
    propiedades.value = r.items;
  } catch {
    // El desplegable queda vacío y el formulario no deja guardar. Es preferible
    // a una lista a medias que hace elegir la propiedad equivocada.
    propiedades.value = [];
  }
}

async function crear() {
  if (!formNuevo.value.propiedadId || !formNuevo.value.descripcion.trim()) return;
  guardando.value = true;
  try {
    await api('/reclamos', {
      method: 'POST',
      body: JSON.stringify({
        propiedadId: formNuevo.value.propiedadId,
        categoria: formNuevo.value.categoria,
        prioridad: formNuevo.value.prioridad,
        descripcion: formNuevo.value.descripcion.trim(),
        ...(formNuevo.value.aCargoDe ? { aCargoDe: formNuevo.value.aCargoDe } : {}),
      }),
    });
    ui.ok('Reclamo abierto', 'Queda en la lista hasta que se resuelva.');
    nuevo.value = false;
    formNuevo.value = {
      propiedadId: '', categoria: 'plomeria', prioridad: 'normal',
      aCargoDe: '', descripcion: '',
    };
    await cargar();
  } catch (e) {
    ui.error('No se pudo abrir', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally {
    guardando.value = false;
  }
}

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    const r = await api<Pagina<Reclamo>>(
      `/reclamos?${consulta(
        { pagina: pagina.value, porPagina: POR_PAGINA },
        {
          q: q.value.trim(),
          estado: filtroEstado.value,
          prioridad: filtroPrioridad.value,
          soloPendientes: soloPendientes.value ? 'true' : '',
        },
      )}`,
    );
    items.value = r.items;
    total.value = r.total;
    paginas.value = r.paginas;
    resolviendo.value = null;
  } catch (e) {
    // Si falló, no se muestran totales: un cero al lado de un error es un
    // número inventado.
    items.value = [];
    total.value = 0;
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los reclamos.';
  } finally {
    cargando.value = false;
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
watch([q, filtroEstado, filtroPrioridad, soloPendientes], () => {
  clearTimeout(debounce);
  pagina.value = 1;
  debounce = setTimeout(cargar, 220);
});
watch(pagina, () => void cargar());
onMounted(cargar);

function abrirResolver(r: Reclamo) {
  if (resolviendo.value === r.id) { resolviendo.value = null; return; }
  resolviendo.value = r.id;
  form.value = { resolucion: '', monto: '', moneda: 'ARS', comprobante: '' };
}

async function resolver(r: Reclamo) {
  if (!form.value.resolucion.trim()) {
    ui.error('Falta la resolución', 'Escribí qué se hizo: es lo que se lee dentro de un año.');
    return;
  }
  guardando.value = true;
  try {
    const monto = form.value.monto.trim() ? Number(form.value.monto) : undefined;
    await api(`/reclamos/${r.id}/resolver`, {
      method: 'POST',
      body: JSON.stringify({
        resolucion: form.value.resolucion.trim(),
        ...(monto ? { monto, moneda: form.value.moneda } : {}),
        ...(form.value.comprobante.trim() ? { comprobante: form.value.comprobante.trim() } : {}),
      }),
    });
    ui.ok(
      'Reclamo resuelto',
      monto
        ? `Se cargó el gasto de ${money(monto, form.value.moneda)}, listo para la liquidación.`
        : 'Sin costo asociado.',
    );
    await cargar();
  } catch (e) {
    ui.error('No se pudo resolver', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally {
    guardando.value = false;
  }
}

async function cambiarEstado(r: Reclamo, estado: 'en_curso' | 'cancelado') {
  try {
    await api(`/reclamos/${r.id}`, { method: 'PATCH', body: JSON.stringify({ estado }) });
    await cargar();
  } catch (e) {
    ui.error('No se pudo actualizar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  }
}

/** El semáforo de antigüedad: un reclamo viejo y abierto es el que duele. */
function tonoDias(r: Reclamo): 'ok' | 'warn' | 'err' | 'neutro' {
  if (r.estado === 'resuelto' || r.estado === 'cancelado') return 'neutro';
  if (r.diasAbierto > 14) return 'err';
  if (r.diasAbierto > 5) return 'warn';
  return 'neutro';
}
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Reclamos"
      :bajada="cargando || error ? '' : `${total} ${total === 1 ? 'reclamo' : 'reclamos'}`"
    >
      <template #acciones>
        <button class="btn" type="button" @click="abrirNuevo">
          {{ nuevo ? 'Cancelar' : 'Nuevo reclamo' }}
        </button>
      </template>
    </PageHeader>

    <!-- El alta va acá y no en otra pantalla: un reclamo se carga con el
         inquilino al teléfono, y perder la lista para volver a buscarla es lo
         que hace que termine en un papel. -->
    <form v-if="nuevo" class="card pad-sm alta" @submit.prevent="crear">
      <h2 class="text-lg">Nuevo reclamo</h2>
      <div class="grilla">
        <label class="campo">
          <span>Propiedad</span>
          <select v-model="formNuevo.propiedadId" required>
            <option value="" disabled>Elegí una</option>
            <option v-for="p in propiedades" :key="p.id" :value="p.id">
              {{ p.etiqueta }} · {{ p.direccion }}
            </option>
          </select>
        </label>
        <label class="campo">
          <span>Categoría</span>
          <select v-model="formNuevo.categoria">
            <option v-for="(t, k) in CATEGORIA" :key="k" :value="k">{{ t }}</option>
          </select>
        </label>
        <label class="campo">
          <span>Prioridad</span>
          <select v-model="formNuevo.prioridad">
            <option v-for="(t, k) in PRIORIDAD" :key="k" :value="k">{{ t }}</option>
          </select>
        </label>
        <label class="campo">
          <span>Quién paga <em>(si ya se sabe)</em></span>
          <select v-model="formNuevo.aCargoDe">
            <option value="">Sin definir</option>
            <option v-for="(t, k) in A_CARGO" :key="k" :value="k">{{ t }}</option>
          </select>
        </label>
      </div>
      <label class="campo">
        <span>Qué pasó</span>
        <textarea
          v-model="formNuevo.descripcion"
          rows="2"
          placeholder="Pierde agua debajo de la bacha de la cocina."
          required
        />
      </label>
      <div class="pie">
        <button class="btn secondary" type="button" @click="nuevo = false">Cancelar</button>
        <button class="btn" type="submit" :disabled="guardando">
          {{ guardando ? 'Guardando…' : 'Abrir el reclamo' }}
        </button>
      </div>
    </form>

    <p v-if="error" class="alert con-accion" role="alert">
      <span>{{ error }}</span>
      <button class="btn secondary sm" type="button" @click="cargar()">Reintentar</button>
    </p>

    <div class="filtros">
      <SearchInput v-model="q" placeholder="Descripción o proveedor…" />

      <label class="campo suave">
        <span>Estado</span>
        <select v-model="filtroEstado">
          <option value="">Todos</option>
          <option v-for="(t, k) in ESTADO" :key="k" :value="k">{{ t }}</option>
        </select>
      </label>

      <label class="campo suave">
        <span>Prioridad</span>
        <select v-model="filtroPrioridad">
          <option value="">Todas</option>
          <option v-for="(t, k) in PRIORIDAD" :key="k" :value="k">{{ t }}</option>
        </select>
      </label>

      <label class="campo suave check">
        <input v-model="soloPendientes" type="checkbox" />
        <span>Sólo pendientes</span>
      </label>
    </div>

    <UiSkeleton v-if="cargando" :filas="5" :alto="72" />

    <UiEmpty
      v-else-if="!error && !items.length"
      titulo="Nada abierto"
      detalle="Cuando el inquilino avise que se rompió algo, se carga acá y queda con su estado, su proveedor y su costo."
    >
      <button class="btn" type="button" @click="abrirNuevo">Cargar el primero</button>
    </UiEmpty>

    <div v-else-if="items.length" class="card sin-padding">
      <ul class="lista">
        <li v-for="r in items" :key="r.id" :class="{ urge: r.prioridad === 'urgente' && r.estado !== 'resuelto' }">
          <div class="fila">
            <div class="que">
              <span class="linea1">
                <span class="mono cod">{{ r.propiedad.etiqueta }}</span>
                <span class="cat">{{ CATEGORIA[r.categoria] ?? r.categoria }}</span>
                <StatusChip :texto="PRIORIDAD[r.prioridad]" :tono="TONO_PRIORIDAD[r.prioridad]" />
                <StatusChip :texto="ESTADO[r.estado]" :tono="r.estado === 'resuelto' ? 'ok' : 'neutro'" />
              </span>
              <p class="desc">{{ r.descripcion }}</p>
              <span class="linea2">
                {{ r.propiedad.direccion }}
                <template v-if="r.reportadoPor"> · avisó {{ r.reportadoPor }}</template>
                <template v-if="r.proveedor"> · {{ r.proveedor.nombre }}</template>
                <template v-if="r.aCargoDe"> · paga {{ A_CARGO[r.aCargoDe] }}</template>
              </span>
              <span v-if="r.resolucion" class="linea2 resuelto">
                {{ r.resolucion }}
                <template v-if="r.gasto">
                  · <b class="mono">{{ money(r.gasto.monto, r.gasto.moneda) }}</b>
                </template>
                <template v-if="r.resueltoEl"> · {{ fecha(r.resueltoEl) }}</template>
              </span>
            </div>

            <div class="lado">
              <StatusChip
                :texto="r.estado === 'resuelto' ? 'cerrado' : `${r.diasAbierto} d abierto`"
                :tono="tonoDias(r)"
              />
              <div v-if="r.estado !== 'resuelto' && r.estado !== 'cancelado'" class="acciones">
                <button
                  v-if="r.estado === 'abierto'"
                  class="btn secondary sm"
                  type="button"
                  @click="cambiarEstado(r, 'en_curso')"
                >
                  En curso
                </button>
                <button
                  v-if="puedeResolver"
                  class="btn sm"
                  type="button"
                  @click="abrirResolver(r)"
                >
                  {{ resolviendo === r.id ? 'Cancelar' : 'Resolver' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Resolver en la fila, no en otra pantalla: se cierran de a varios. -->
          <form v-if="resolviendo === r.id" class="resolver" @submit.prevent="resolver(r)">
            <label class="campo">
              <span>Qué se hizo</span>
              <textarea
                v-model="form.resolucion"
                rows="2"
                placeholder="Se cambió el flexible y se selló la unión."
                required
              />
            </label>

            <div class="plata">
              <label class="campo">
                <span>Costo <em>(opcional)</em></span>
                <input v-model="form.monto" inputmode="decimal" placeholder="0,00" />
              </label>
              <label class="campo">
                <span>Moneda</span>
                <select v-model="form.moneda">
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </select>
              </label>
              <label class="campo">
                <span>Comprobante</span>
                <input v-model="form.comprobante" placeholder="FC-A-0001" />
              </label>
            </div>

            <p class="ayuda">
              Con costo se carga el gasto y entra en la próxima liquidación del
              propietario. Sin costo, sólo se cierra el reclamo.
            </p>

            <div class="pie">
              <button class="btn secondary" type="button" @click="resolviendo = null">Cancelar</button>
              <button class="btn" type="submit" :disabled="guardando">
                {{ guardando ? 'Guardando…' : 'Resolver' }}
              </button>
            </div>
          </form>
        </li>
      </ul>
    </div>

    <UiPager
      v-if="paginas > 1"
      v-model:pagina="pagina"
      :paginas="paginas"
      :total="total"
      :por-pagina="POR_PAGINA"
      sustantivo="reclamos"
    />
  </div>
</template>

<style scoped>
.lista li { border-bottom: 1px solid var(--line); }
.lista li:last-child { border-bottom: none; }
/* La barra sólo en lo urgente y abierto: si marcara todo, no marcaría nada. */
.lista li.urge { box-shadow: inset 3px 0 0 var(--danger); }

.fila {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: var(--s-lg); padding: var(--s-md) var(--s-lg);
}
.que { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.linea1 { display: flex; align-items: center; gap: var(--s-sm); flex-wrap: wrap; }
.cod { font-size: 11px; color: var(--muted); }
.cat { color: var(--ink); font-weight: 500; font-size: 13px; }
.desc { margin: 0; font-size: 13px; color: var(--ink-2); }
.linea2 { font-size: 12px; color: var(--muted); }
.linea2.resuelto { color: var(--success-ink); }
.linea2 b { font-weight: 600; }

.lado { display: flex; flex-direction: column; align-items: flex-end; gap: var(--s-sm); flex: none; }
.acciones { display: flex; gap: var(--s-xs); }

.resolver {
  display: flex; flex-direction: column; gap: var(--s-md);
  padding: var(--s-lg); background: var(--surface-2);
  border-top: 1px solid var(--line);
}
.plata { display: flex; gap: var(--s-md); flex-wrap: wrap; }
.plata .campo { flex: 1 1 140px; }
.ayuda { margin: 0; font-size: 12px; color: var(--muted); }
.pie { display: flex; justify-content: flex-end; gap: var(--s-sm); }

.campo.check { flex-direction: row; align-items: center; gap: var(--s-sm); }
.campo.check input { width: auto; }

.alta { display: flex; flex-direction: column; gap: var(--s-md); }
.alta h2 { margin: 0; }
.grilla {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--s-md);
}

@media (max-width: 640px) {
  .fila { flex-direction: column; }
  .lado { align-items: flex-start; width: 100%; }
}
</style>
