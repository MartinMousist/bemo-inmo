<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, descargar } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import SearchInput from '../componentes/SearchInput.vue';
import SelectAgente from '../componentes/SelectAgente.vue';
import StatusChip from '../componentes/StatusChip.vue';
import ThOrden from '../componentes/ThOrden.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiPager from '../componentes/UiPager.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha, money, numero, plural, ETIQUETA_TIPO } from '../dominio/formato';
import { filtrosRecordados } from '../dominio/filtros';
import { hayFiltroDeAgente, paramsDeAgente } from '../dominio/agente';
import { consulta, type Pagina } from '../dominio/pagina';
import { useAuth } from '../stores/auth';

/**
 * La cartera en venta y la cartera en alquiler, por separado.
 *
 * Antes era **una sola lista** con un filtro «Todas / Venta / Alquiler». Eso
 * las trata como si fueran lo mismo, y no lo son: se miran en momentos
 * distintos, se ordenan por cosas distintas y las columnas que importan no se
 * superponen.
 *
 *   · En **venta** lo que se mira es el precio, los metros y **hace cuánto está
 *     publicada**. Una propiedad con 140 días en el mercado es una conversación
 *     con el propietario sobre el precio, y ese dato no existía en ninguna
 *     pantalla.
 *   · En **alquiler** lo que se mira es el precio con sus expensas y, sobre
 *     todo, **si está ocupada**. «Disponible» es el estado de la publicación,
 *     no de la unidad: una con contrato hasta 2028 puede seguir figurando
 *     disponible porque nadie tocó el estado de la operación.
 *
 * Es un solo componente con dos rutas y no dos archivos copiados: lo que cambia
 * son las columnas, no la pantalla. Dos copias divergen al primer arreglo que
 * se haga en una sola.
 */

interface Operacion {
  id: string;
  tipo: string;
  precio: number | null;
  moneda: string;
  expensas: number | null;
  expensasMoneda: string;
  estado: string;
  exclusividadHasta: string | null;
  fechaPublicacion: string | null;
  contratoHasta: string | null;
}

interface Propiedad {
  id: string;
  etiqueta: string;
  direccion: string;
  tipo: string;
  supTotal: number | null;
  ambientes: number | null;
  dormitorios: number | null;
  cocheras: number | null;
  ubicacionConocida: boolean;
  agenteCaptador: { id: string; nombre: string } | null;
  operaciones: Operacion[];
}

const ESTADO: Record<string, string> = {
  borrador: 'Borrador', disponible: 'Disponible', reservada: 'Reservada',
  cerrada: 'Cerrada', suspendida: 'Suspendida',
};
const TONO_ESTADO: Record<string, 'ok' | 'warn' | 'err' | 'neutro'> = {
  borrador: 'neutro', disponible: 'ok', reservada: 'warn',
  cerrada: 'neutro', suspendida: 'err',
};

const POR_PAGINA = 25;

const ruta = useRoute();
const router = useRouter();

/** `venta` o `alquiler`. Sale de la ruta, no de un filtro que se pueda tocar. */
const operacion = computed<'venta' | 'alquiler'>(() =>
  ruta.path.includes('/alquiler') ? 'alquiler' : 'venta',
);
const esVenta = computed(() => operacion.value === 'venta');

const items = ref<Propiedad[]>([]);
const total = ref(0);
const paginas = ref(1);
const pagina = ref(1);
const cargando = ref(true);
const error = ref('');
const q = ref('');

const auth = useAuth();

// `agente` NO lleva lista de válidos acá: los uuid del equipo llegan por fetch
// y el helper valida en el constructor, contra listas estáticas. La regla 2
// —descartar un valor que ya no existe— la aplica `SelectAgente` cuando el
// equipo terminó de cargar.
const { valores: filtros, limpiar: limpiarFiltros } = filtrosRecordados(
  'cartera-propiedades',
  { tipo: '', estado: '', agente: '' },
  { tipo: Object.keys(ETIQUETA_TIPO), estado: Object.keys(ESTADO) },
);

const orden = ref<string | null>(null);
const dir = ref<'asc' | 'desc'>('asc');

function ordenarPor(campo: string | null, d: 'asc' | 'desc') {
  orden.value = campo;
  dir.value = d;
  pagina.value = 1;
  void cargar();
}

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    const r = await api<Pagina<Propiedad>>(
      `/propiedades?${consulta(
        { pagina: pagina.value, porPagina: POR_PAGINA },
        {
          q: q.value.trim(),
          operacion: operacion.value,
          // La cartera muestra lo que la inmobiliaria TIENE, no lo que ofrece:
          // una unidad alquilada tiene su operación en `cerrada` y sin esto no
          // aparecía. Es la diferencia entre 13 propiedades y 3.
          incluirCerradas: 'true',
          tipo: filtros.value.tipo,
          estado: filtros.value.estado,
          ...paramsDeAgente(filtros.value.agente, auth.usuario?.id ?? null),
          orden: orden.value ?? '',
          dir: orden.value ? dir.value : '',
        },
      )}`,
    );
    items.value = r.items;
    total.value = r.total;
    paginas.value = r.paginas;
  } catch (e) {
    // Igual que en el resto: si falló, no se muestran totales. Un cero al lado
    // de un error es un número inventado.
    items.value = [];
    total.value = 0;
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la cartera.';
  } finally {
    cargando.value = false;
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
// `deep: true`: `filtros` es un ref que guarda un objeto y elegir un tipo o un
// estado lo MUTA, sin cambiar su identidad. Sin esto el watch nunca se enteraba
// y la lista no se recargaba: la preferencia quedaba guardada y recién se
// aplicaba la próxima vez que se abría la pantalla. Ver el comentario largo en
// `ContratosPage.vue`, que es donde apareció.
watch([q, filtros], () => {
  clearTimeout(debounce);
  pagina.value = 1;
  debounce = setTimeout(cargar, 220);
}, { deep: true });
watch(pagina, () => void cargar());
// Cambiar de venta a alquiler es cambiar de listado: se limpia todo lo que era
// del anterior, incluida la página.
watch(operacion, () => {
  pagina.value = 1;
  orden.value = null;
  void cargar();
});
onMounted(cargar);

/** La operación de este listado. Es la que da todas las columnas de plata. */
function op(p: Propiedad): Operacion | undefined {
  return p.operaciones.find((o) =>
    esVenta.value ? o.tipo === 'venta' : o.tipo.startsWith('alquiler'),
  );
}

/** Días desde que se publicó. `null` si nunca se publicó. */
function diasEnMercado(o: Operacion | undefined): number | null {
  if (!o?.fechaPublicacion) return null;
  const desde = new Date(`${o.fechaPublicacion.slice(0, 10)}T00:00:00`);
  return Math.floor((Date.now() - desde.getTime()) / 86_400_000);
}

/**
 * El semáforo de los días en mercado.
 *
 * No es decoración: en venta, pasar los 90 días sin oferta es la señal de que
 * el precio está por encima del mercado, y es la conversación que hay que tener
 * con el propietario. Los cortes son los que usa el rubro.
 */
function tonoDias(d: number | null): 'ok' | 'warn' | 'err' | 'neutro' {
  if (d === null) return 'neutro';
  if (d > 180) return 'err';
  if (d > 90) return 'warn';
  return 'neutro';
}

const hayFiltro = computed(
  () => !!(q.value || filtros.value.tipo || filtros.value.estado || orden.value)
    || hayFiltroDeAgente(filtros.value.agente),
);

function limpiarTodo() {
  q.value = '';
  orden.value = null;
  dir.value = 'asc';
  limpiarFiltros();
}

async function exportar() {
  try { await descargar('/exportar/propiedades.csv'); }
  catch (e) { error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo exportar.'; }
}
</script>

<template>
  <div class="stack">
    <PageHeader
      :titulo="esVenta ? 'Propiedades en venta' : 'Propiedades en alquiler'"
      :bajada="cargando || error ? '' : plural(total, 'propiedad', 'propiedades')"
    >
      <template #acciones>
        <!-- El cambio entre las dos carteras vive acá y no en un filtro: son
             dos listados, no dos vistas del mismo. -->
        <div class="segmented">
          <button
            type="button" :class="{ activo: esVenta }"
            @click="router.push('/propiedades/venta')"
          >
            Venta
          </button>
          <button
            type="button" :class="{ activo: !esVenta }"
            @click="router.push('/propiedades/alquiler')"
          >
            Alquiler
          </button>
        </div>
        <button class="btn secondary" type="button" @click="exportar">Exportar</button>
        <RouterLink class="btn" to="/propiedades/nueva">Nueva propiedad</RouterLink>
      </template>
    </PageHeader>

    <p v-if="error" class="alert con-accion" role="alert">
      <span>{{ error }}</span>
      <button class="btn secondary sm" type="button" @click="cargar()">Reintentar</button>
    </p>

    <div class="filtros">
      <SearchInput v-model="q" placeholder="Dirección, localidad o código…" />

      <label class="campo suave">
        <span>Tipo</span>
        <select v-model="filtros.tipo">
          <option value="">Todos</option>
          <option v-for="(t, k) in ETIQUETA_TIPO" :key="k" :value="k">{{ t }}</option>
        </select>
      </label>

      <label class="campo suave">
        <span>Estado</span>
        <select v-model="filtros.estado">
          <option value="">Todos</option>
          <option v-for="(t, k) in ESTADO" :key="k" :value="k">{{ t }}</option>
        </select>
      </label>

      <SelectAgente v-model="filtros.agente" etiqueta="Captó" con-sin-asignar />

      <button v-if="hayFiltro" class="btn secondary sm" type="button" @click="limpiarTodo">
        Limpiar
      </button>
    </div>

    <!-- `GET /exportar/:recurso.csv` no toma ningún filtro: baja la cartera
         entera. Al lado de una lista filtrada, quien apreta cree lo contrario. -->
    <p v-if="hayFiltro" class="aviso-exportar">
      El botón «Exportar» baja la cartera completa, no lo que está filtrado.
    </p>

    <UiSkeleton v-if="cargando" :filas="5" :alto="48" />

    <UiEmpty
      v-else-if="!error && !items.length && hayFiltro"
      titulo="Ninguna propiedad coincide"
      detalle="Probá con otro texto, otro tipo u otro estado."
    >
      <button class="btn secondary" type="button" @click="limpiarTodo">Quitar filtros</button>
    </UiEmpty>

    <UiEmpty
      v-else-if="!error && !items.length"
      :titulo="esVenta ? 'Ninguna propiedad en venta' : 'Ninguna propiedad en alquiler'"
      :detalle="esVenta
        ? 'Una propiedad entra acá cuando se le carga una operación de venta. La misma propiedad puede estar en venta y en alquiler a la vez.'
        : 'Una propiedad entra acá cuando se le carga una operación de alquiler. La misma propiedad puede estar en alquiler y en venta a la vez.'"
    >
      <RouterLink class="btn" to="/propiedades/nueva">Cargar una propiedad</RouterLink>
    </UiEmpty>

    <div v-else-if="items.length" class="card sin-padding">
      <table class="table-clicable">
        <thead>
          <tr>
            <ThOrden campo="codigo" :actual="orden" :dir="dir" @ordenar="ordenarPor">
              Código
            </ThOrden>
            <ThOrden campo="direccion" :actual="orden" :dir="dir" @ordenar="ordenarPor">
              Dirección
            </ThOrden>
            <th class="secundaria">Tipo</th>
            <!-- Se puede filtrar por captador, así que la fila tiene que decir
                 de quién es: una lista filtrada por una persona en la que no se
                 ve el nombre obliga a confiar en el filtro a ciegas. -->
            <th class="secundaria">Captó</th>

            <!-- ── Columnas de VENTA ─────────────────────────────────────── -->
            <template v-if="esVenta">
              <ThOrden campo="superficie" num :actual="orden" :dir="dir" @ordenar="ordenarPor">
                m²
              </ThOrden>
              <ThOrden campo="precio" num :actual="orden" :dir="dir" @ordenar="ordenarPor">
                Precio
              </ThOrden>
              <ThOrden campo="publicada" :actual="orden" :dir="dir" @ordenar="ordenarPor">
                En mercado
              </ThOrden>
              <th class="secundaria">Exclusividad</th>
            </template>

            <!-- ── Columnas de ALQUILER ──────────────────────────────────── -->
            <template v-else>
              <th class="der secundaria">Amb.</th>
              <ThOrden campo="precio" num :actual="orden" :dir="dir" @ordenar="ordenarPor">
                Alquiler
              </ThOrden>
              <th class="der secundaria">Expensas</th>
              <!--
                Una sola columna y no «Ocupación» + «Estado».
                El estado de la OPERACIÓN de una unidad alquilada es `cerrada`,
                y ponerlo al lado de «ocupada hasta 2028» dice lo mismo dos
                veces con dos palabras distintas — y encima «Cerrada» suena a
                que la propiedad se fue de la cartera, que es lo contrario.
                Cuando está ocupada manda el contrato; cuando está libre, el
                estado sí importa: disponible no es lo mismo que reservada.
              -->
              <th>Situación</th>
            </template>

            <th v-if="esVenta">Estado</th>
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="p in items"
            :key="p.id"
            tabindex="0"
            :aria-label="`${p.etiqueta} · ${p.direccion}`"
            @click="router.push(`/propiedades/${p.id}`)"
            @keydown.enter="router.push(`/propiedades/${p.id}`)"
          >
            <td class="mono cod">{{ p.etiqueta }}</td>
            <td>
              <span class="dir">{{ p.direccion }}</span>
              <span v-if="!p.ubicacionConocida" class="sin-ubi">sin ubicar</span>
            </td>
            <td class="secundaria">{{ ETIQUETA_TIPO[p.tipo] ?? p.tipo }}</td>
            <td class="secundaria chico">
              <span v-if="p.agenteCaptador">{{ p.agenteCaptador.nombre }}</span>
              <span v-else class="vacio">sin captador</span>
            </td>

            <template v-if="esVenta">
              <td class="num">{{ numero(p.supTotal) }}</td>
              <td class="num fuerte">{{ money(op(p)?.precio ?? null, op(p)?.moneda ?? 'USD') }}</td>
              <td>
                <StatusChip
                  v-if="diasEnMercado(op(p)) !== null"
                  :texto="plural(diasEnMercado(op(p)), 'día', 'días')"
                  :tono="tonoDias(diasEnMercado(op(p)))"
                />
                <!-- Sin fecha de publicación no se inventa un cero: «recién
                     publicada» y «nunca se publicó» no son lo mismo. -->
                <span v-else class="vacio">sin publicar</span>
              </td>
              <td class="secundaria">
                <span v-if="op(p)?.exclusividadHasta" class="mono chico">
                  hasta {{ fecha(op(p)!.exclusividadHasta) }}
                </span>
                <span v-else class="vacio">—</span>
              </td>
            </template>

            <template v-else>
              <td class="der mono secundaria">{{ numero(p.ambientes) }}</td>
              <td class="num fuerte">{{ money(op(p)?.precio ?? null, op(p)?.moneda ?? 'ARS') }}</td>
              <td class="der mono secundaria chico">
                <template v-if="op(p)?.expensas">
                  + {{ money(op(p)!.expensas, op(p)!.expensasMoneda) }}
                </template>
                <span v-else class="vacio">—</span>
              </td>
              <td>
                <!-- La pregunta que se le hace a este listado: ¿qué tengo para
                     ofrecer hoy? El estado de la publicación no la contesta. -->
                <StatusChip
                  v-if="op(p)?.contratoHasta"
                  :texto="`ocupada hasta ${fecha(op(p)!.contratoHasta)}`"
                  tono="neutro"
                />
                <StatusChip
                  v-else
                  :texto="op(p)?.estado === 'disponible' ? 'libre' : (ESTADO[op(p)?.estado ?? ''] ?? '—')"
                  :tono="op(p)?.estado === 'disponible' ? 'ok' : (TONO_ESTADO[op(p)?.estado ?? ''] ?? 'neutro')"
                />
              </td>
            </template>

            <td v-if="esVenta">
              <StatusChip
                :texto="ESTADO[op(p)?.estado ?? ''] ?? '—'"
                :tono="TONO_ESTADO[op(p)?.estado ?? ''] ?? 'neutro'"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UiPager
      v-if="paginas > 1"
      v-model:pagina="pagina"
      :paginas="paginas"
      :total="total"
      :por-pagina="POR_PAGINA"
      sustantivo="propiedades"
    />
  </div>
</template>

<style scoped>
.cod { color: var(--muted); white-space: nowrap; }
.dir { color: var(--ink); }
.sin-ubi { margin-left: var(--s-sm); font-size: 11px; color: var(--warning-ink); }
.vacio { color: var(--muted-2); }
.chico { font-size: 12px; }
.aviso-exportar { margin: 0; font-size: 12px; color: var(--muted); }
.fuerte { color: var(--ink); }

/* Tipo, metros y expensas se van en pantalla angosta: el precio y la ocupación
   son lo que se busca, el resto está en la ficha. */
@media (max-width: 860px) {
  .secundaria { display: none; }
}
</style>
