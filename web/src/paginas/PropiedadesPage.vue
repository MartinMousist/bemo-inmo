<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError, descargar } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import { pct } from '../dominio/comisiones';
import PageHeader from '../componentes/PageHeader.vue';
import PanelMapas from '../componentes/PanelMapas.vue';
import PropiedadesGrilla from '../componentes/PropiedadesGrilla.vue';
import SearchInput from '../componentes/SearchInput.vue';
import SelectAgente from '../componentes/SelectAgente.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import VistaToggle from '../componentes/VistaToggle.vue';
import {
  ETIQUETA_OPERACION,
  ETIQUETA_TIPO,
  etiquetaSituacion,
  money,
  moneyCorto,
  numero,
  tonoSituacion,
} from '../dominio/formato';
import { hayFiltroDeAgente, paramsDeAgente } from '../dominio/agente';
import { filtrosRecordados } from '../dominio/filtros';
import { guardarVista, leerVista, type Vista } from '../dominio/vista';
import {
  AMENITIES_AGRUPADOS, CALEFACCIONES, DISPOSICIONES, ORIENTACIONES, URBANIZACIONES,
} from '../dominio/catalogos-propiedad';

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
  /**
   * Quién cobra esta comisión, cuando ya está repartida.
   *
   * Vacío mientras la operación no cerró. Un porcentaje sin dueño es la
   * pregunta que la pantalla dejaba sin contestar: se veía «6 %» y no de quién
   * era, que es justo lo que se mira cuando se abre el listado.
   */
  beneficiarios: Array<{
    nombre: string; tipo: string; punta: string | null;
    porcentaje: number; monto: number; moneda: string; estado: string;
  }>;
}

interface Propiedad {
  id: string;
  etiqueta: string;
  direccion: string;
  tipo: string;
  ambientes: number | null;
  supTotal: number | null;
  /**
   * Los cuatro que la tabla no usaba y la API YA devolvía.
   *
   * `aPropiedad()` los mapea desde la migración 006; esta interfaz simplemente
   * no los declaraba, así que en el front no existían. Los necesita la tarjeta
   * para su fila de íconos — y la regla de que un terreno no tiene dormitorios
   * la resuelve `dominio/atributos.ts`, no un `v-if` acá.
   */
  supCubierta: number | null;
  dormitorios: number | null;
  banos: number | null;
  cocheras: number | null;
  fotoPortada: string | null;
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

/** El desglose completo, para el `title` del total. Lo que dejó de estar fijo. */
function detalleHonorarios(o: Operacion): string {
  const puntas = puntasDe(o).map((x) => `${x.etiqueta} ${x.valor} %`).join(' + ');
  return `${puntas} · ${o.comision?.propio ? 'propios de esta propiedad' : 'de la casa'}`;
}

/**
 * Un nombre, y cuántos más hay.
 *
 * Con comisión compartida son tres o cuatro líneas —la externa, el captador, el
 * cerrador— y ponerlas todas devuelve la celda al problema que esto vino a
 * resolver. El nombre que se muestra es el de la parte MÁS grande, que es como
 * viene ordenado del back.
 */
function quienCobra(o: Operacion): string {
  const [primero, ...resto] = o.beneficiarios;
  return resto.length ? `${primero.nombre} +${resto.length}` : primero.nombre;
}

function quienCobraCompleto(o: Operacion): string {
  return o.beneficiarios
    .map((b) => `${b.nombre}: ${money(b.monto, b.moneda)} (${b.estado})`)
    .join(' · ');
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
/**
 * Los filtros de la migración 027, todos como STRING —incluidos los rangos y
 * los multi-select— porque `filtrosRecordados` sólo persiste
 * `Record<string, string | boolean>`, y porque un `<input>` vacío ya es `''`:
 * forzarlo a `number | undefined` acá sólo para volver a stringificarlo al
 * armar la URL no ahorra nada.
 *
 * Los multi-select (`orientacion`, `disposicion`, `calefaccion`, `amenities`)
 * se guardan como CSV — `"pileta,seguridad"` — que es exactamente lo que
 * `listaDesdeQuery()` del back ya sabe leer en un querystring.
 */
const { valores: filtros } = filtrosRecordados('propiedades', {
  agente: '',
  ambientesMin: '', ambientesMax: '',
  dormitoriosMin: '', dormitoriosMax: '',
  banosMin: '', banosMax: '',
  toilettesMin: '', toilettesMax: '',
  cocherasMin: '', cocherasMax: '',
  plantasMin: '', plantasMax: '',
  antiguedadMax: '',
  supTotalMin: '', supTotalMax: '',
  supCubiertaMin: '', supCubiertaMax: '',
  orientacion: '', disposicion: '', calefaccion: '', amenities: '',
  tipoUrbanizacion: '',
  // El precio va SIEMPRE con su moneda: un rango sin moneda mezcla un alquiler
  // de ARS 380.000 con una venta de USD 118.000 en la misma lista.
  precioMin: '', precioMax: '', precioMoneda: 'USD',
  expensasMin: '', expensasMax: '', expensasMoneda: 'ARS',
});

/** Las claves de rango/multi-select, en el orden en que se mandan a la API. */
const CAMPOS_RANGO = [
  'ambientesMin', 'ambientesMax', 'dormitoriosMin', 'dormitoriosMax',
  'banosMin', 'banosMax', 'toilettesMin', 'toilettesMax',
  'cocherasMin', 'cocherasMax', 'plantasMin', 'plantasMax', 'antiguedadMax',
  'supTotalMin', 'supTotalMax', 'supCubiertaMin', 'supCubiertaMax',
  'precioMin', 'precioMax', 'expensasMin', 'expensasMax',
] as const;

// `precioMoneda` y `expensasMoneda` NO entran en ninguna de las dos listas de
// arriba. Tienen un valor por defecto —USD para precio, ARS para expensas, que
// es como se cotiza cada cosa en esta plaza—, así que «tiene valor» no
// significa «está filtrando»: sin un rango cargado, la moneda sola no recorta
// nada. Incluirlas dejaría el chip «activos» encendido para siempre.
const CAMPOS_MULTI = [
  'orientacion', 'disposicion', 'calefaccion', 'amenities', 'tipoUrbanizacion',
] as const;

const hayMasFiltros = computed(
  () => CAMPOS_RANGO.some((k) => filtros.value[k] !== '')
    || CAMPOS_MULTI.some((k) => filtros.value[k] !== ''),
);

const hayFiltro = computed(
  () => !!q.value || !!filtroOperacion.value
    || hayFiltroDeAgente(filtros.value.agente) || hayMasFiltros.value,
);

/**
 * Toggle de un valor dentro de un CSV guardado en `filtros`.
 *
 * Los checkboxes de orientación/disposición/calefacción/amenities no tienen un
 * `v-model` directo a un array —el filtro guardado es un string, no una lista,
 * por la restricción de `filtrosRecordados` de arriba— así que arman y
 * desarman el CSV a mano.
 */
function tieneEnCsv(csv: string, clave: string): boolean {
  return csv.split(',').includes(clave);
}
function alternarEnCsv(campo: typeof CAMPOS_MULTI[number], clave: string): void {
  const actual = filtros.value[campo] ? filtros.value[campo].split(',') : [];
  const sin = actual.filter((c) => c !== clave);
  filtros.value[campo] = (sin.length === actual.length ? [...actual, clave] : sin).join(',');
}

function limpiarMasFiltros(): void {
  for (const k of CAMPOS_RANGO) filtros.value[k] = '';
  for (const k of CAMPOS_MULTI) filtros.value[k] = '';
  // Las monedas vuelven a su default, no a vacío: `''` no es una moneda.
  filtros.value.precioMoneda = 'USD';
  filtros.value.expensasMoneda = 'ARS';
}

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
    for (const k of CAMPOS_RANGO) {
      if (filtros.value[k] !== '') params.set(k, filtros.value[k]);
    }
    for (const k of CAMPOS_MULTI) {
      if (filtros.value[k] !== '') params.set(k, filtros.value[k]);
    }
    // La moneda acompaña a su rango: sola no filtra nada y mandarla sería
    // ensuciar la URL con un parámetro que no cambia el resultado.
    if (filtros.value.precioMin || filtros.value.precioMax) {
      params.set('precioMoneda', filtros.value.precioMoneda);
    }
    if (filtros.value.expensasMin || filtros.value.expensasMax) {
      params.set('expensasMoneda', filtros.value.expensasMoneda);
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

/**
 * Tabla o tarjetas. La preferencia se guarda y la comparten las tres pantallas
 * de propiedades: ver `dominio/vista.ts`.
 *
 * No se resetea con «Quitar filtros»: la vista es espacio de trabajo, el filtro
 * es una pregunta.
 */
const vista = ref<Vista>(leerVista());
watch(vista, (v) => guardarVista(v));

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
        <VistaToggle v-model:modelo="vista" />
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

    <!-- Todo lo que la migración 027 sumó: rangos numéricos y multi-select.
         Colapsado por default —siete atributos más veintitantos amenities son
         ruido en la pantalla que se abre siempre, y esta es la que se abre
         siempre—. El resumen dice cuántos están activos para que no haga falta
         desplegar el panel sólo para saber si hay algo filtrando. -->
    <details class="ajuste mas-filtros">
      <summary>
        Más filtros
        <StatusChip v-if="hayMasFiltros" texto="activos" tono="acento" />
      </summary>

      <div class="stack">
        <div class="grid-rangos">
          <label class="rango"><span>Ambientes</span>
            <input v-model="filtros.ambientesMin" inputmode="numeric" placeholder="Desde" />
            <input v-model="filtros.ambientesMax" inputmode="numeric" placeholder="Hasta" />
          </label>
          <label class="rango"><span>Dormitorios</span>
            <input v-model="filtros.dormitoriosMin" inputmode="numeric" placeholder="Desde" />
            <input v-model="filtros.dormitoriosMax" inputmode="numeric" placeholder="Hasta" />
          </label>
          <label class="rango"><span>Baños</span>
            <input v-model="filtros.banosMin" inputmode="numeric" placeholder="Desde" />
            <input v-model="filtros.banosMax" inputmode="numeric" placeholder="Hasta" />
          </label>
          <label class="rango"><span>Toilettes</span>
            <input v-model="filtros.toilettesMin" inputmode="numeric" placeholder="Desde" />
            <input v-model="filtros.toilettesMax" inputmode="numeric" placeholder="Hasta" />
          </label>
          <label class="rango"><span>Cocheras</span>
            <input v-model="filtros.cocherasMin" inputmode="numeric" placeholder="Desde" />
            <input v-model="filtros.cocherasMax" inputmode="numeric" placeholder="Hasta" />
          </label>
          <label class="rango"><span>Plantas</span>
            <input v-model="filtros.plantasMin" inputmode="numeric" placeholder="Desde" />
            <input v-model="filtros.plantasMax" inputmode="numeric" placeholder="Hasta" />
          </label>
          <label class="rango"><span>Sup. total (m²)</span>
            <input v-model="filtros.supTotalMin" inputmode="decimal" placeholder="Desde" />
            <input v-model="filtros.supTotalMax" inputmode="decimal" placeholder="Hasta" />
          </label>
          <label class="rango"><span>Sup. cubierta (m²)</span>
            <input v-model="filtros.supCubiertaMin" inputmode="decimal" placeholder="Desde" />
            <input v-model="filtros.supCubiertaMax" inputmode="decimal" placeholder="Hasta" />
          </label>
          <!-- Sólo el máximo: acá se busca «hasta X años», no un rango exacto. -->
          <label class="rango rango-simple"><span>Antigüedad (hasta, años)</span>
            <input v-model="filtros.antiguedadMax" inputmode="numeric" placeholder="Años" />
          </label>
        </div>

        <!-- Precio y expensas van aparte de la grilla de arriba porque llevan
             un control más: la moneda. Un rango de precio sin moneda mezcla un
             alquiler de ARS 380.000 con una venta de USD 118.000. -->
        <div class="grid-rangos">
          <div class="rango con-moneda">
            <span>Precio</span>
            <select v-model="filtros.precioMoneda" aria-label="Moneda del precio">
              <option value="USD">USD</option>
              <option value="ARS">ARS</option>
            </select>
            <input v-model="filtros.precioMin" inputmode="decimal" placeholder="Desde" />
            <input v-model="filtros.precioMax" inputmode="decimal" placeholder="Hasta" />
          </div>
          <div class="rango con-moneda">
            <span>Expensas</span>
            <select v-model="filtros.expensasMoneda" aria-label="Moneda de las expensas">
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
            <input v-model="filtros.expensasMin" inputmode="decimal" placeholder="Desde" />
            <input v-model="filtros.expensasMax" inputmode="decimal" placeholder="Hasta" />
          </div>
        </div>

        <!-- Se dice, en vez de adivinar: el precio vive en la operación, y una
             propiedad puede estar en venta Y en alquiler a la vez. -->
        <p v-if="(filtros.precioMin || filtros.precioMax) && !filtroOperacion" class="nota-precio">
          Estás filtrando por precio sin elegir Venta o Alquiler: se busca en las dos
          puntas, así que una casa puede entrar por el precio de su alquiler.
        </p>

        <div class="grupo-multi">
          <h3>Orientación</h3>
          <div class="chips-check">
            <label v-for="o in ORIENTACIONES" :key="o.clave" class="chip-check">
              <input
                type="checkbox"
                :checked="tieneEnCsv(filtros.orientacion, o.clave)"
                @change="alternarEnCsv('orientacion', o.clave)"
              />
              <span>{{ o.etiqueta }}</span>
            </label>
          </div>
        </div>

        <div class="grupo-multi">
          <h3>Disposición</h3>
          <div class="chips-check">
            <label v-for="d in DISPOSICIONES" :key="d.clave" class="chip-check">
              <input
                type="checkbox"
                :checked="tieneEnCsv(filtros.disposicion, d.clave)"
                @change="alternarEnCsv('disposicion', d.clave)"
              />
              <span>{{ d.etiqueta }}</span>
            </label>
          </div>
        </div>

        <div class="grupo-multi">
          <h3>Calefacción</h3>
          <div class="chips-check">
            <label v-for="c in CALEFACCIONES" :key="c.clave" class="chip-check">
              <input
                type="checkbox"
                :checked="tieneEnCsv(filtros.calefaccion, c.clave)"
                @change="alternarEnCsv('calefaccion', c.clave)"
              />
              <span>{{ c.etiqueta }}</span>
            </label>
          </div>
        </div>

        <div class="grupo-multi">
          <h3>Urbanización</h3>
          <div class="chips-check">
            <label v-for="u in URBANIZACIONES" :key="u.clave" class="chip-check">
              <input
                type="checkbox"
                :checked="tieneEnCsv(filtros.tipoUrbanizacion, u.clave)"
                @change="alternarEnCsv('tipoUrbanizacion', u.clave)"
              />
              <span>{{ u.etiqueta }}</span>
            </label>
          </div>
        </div>

        <!-- Amenities: «tiene TODOS los que se marquen», no «tiene alguno» —
             la misma regla `@>` del back. Marcar Pileta y Seguridad pide una
             propiedad con las dos, no cualquiera de las dos. -->
        <div class="grupo-multi">
          <h3>Amenities</h3>
          <div v-for="grupo in AMENITIES_AGRUPADOS" :key="grupo.categoria" class="subgrupo-amenities">
            <p class="subtitulo">{{ grupo.categoria }}</p>
            <div class="chips-check">
              <label v-for="op in grupo.items" :key="op.clave" class="chip-check">
                <input
                  type="checkbox"
                  :checked="tieneEnCsv(filtros.amenities, op.clave)"
                  @change="alternarEnCsv('amenities', op.clave)"
                />
                <span>{{ op.etiqueta }}</span>
              </label>
            </div>
          </div>
        </div>

        <button v-if="hayMasFiltros" class="btn secondary sm limpiar-mas"
                type="button" @click="limpiarMasFiltros">
          Limpiar estos filtros
        </button>
      </div>
    </details>

    <!-- «Exportar» baja SIEMPRE la cartera completa: `GET /exportar/:recurso.csv`
         no toma ningún filtro. Con una lista filtrada al lado, quien apreta cree
         que se está bajando lo que ve. Se dice, en vez de sacar el botón: bajar
         todo sigue siendo lo que la mayoría quiere. -->
    <p v-if="hayFiltro" class="aviso-exportar">
      El botón «Exportar» baja la cartera completa, no lo que está filtrado.
    </p>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <!-- En tarjetas la grilla va SUELTA, sin la tarjeta contenedora: una
         tarjeta de tarjetas es un marco alrededor de otro marco. El estado
         vacío y el error siguen entrando por el `v-else`, con el mismo copy y
         el mismo lugar en las dos vistas. -->
    <PropiedadesGrilla
      v-if="vista === 'tarjetas' && (cargando || items.length > 0)"
      :items="items"
      :cargando="cargando"
    />

    <div v-else class="card sin-padding">
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
          @click="q = ''; filtroOperacion = ''; filtros.agente = ''; limpiarMasFiltros()"
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
                    <StatusChip
                      :texto="etiquetaSituacion(o.estado, o.tipo)"
                      :tono="tonoSituacion(o.estado)"
                    />
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

                    <!-- En reposo, dos datos y nada más: cuánto y de quién.
                         Antes esta celda mostraba total, desglose por punta,
                         origen y un botón, por cada operación — cuatro cosas
                         por fila que en una tabla de 25 filas se leen como
                         ruido. El desglose y el origen pasaron a la ficha, que
                         es donde se los va a buscar; acá quedan a un clic. -->
                    <div v-else class="op">
                      <component
                        :is="puedeEditarComision ? 'button' : 'span'"
                        class="hon-total"
                        :type="puedeEditarComision ? 'button' : undefined"
                        :title="detalleHonorarios(o)"
                        :aria-label="puedeEditarComision
                          ? `Cambiar honorarios: ${detalleHonorarios(o)}`
                          : detalleHonorarios(o)"
                        @click="puedeEditarComision && abrirComision(p, o)">
                        <span class="mono total">{{ pct(o.comision?.total ?? 0) }}</span>
                        <!-- El punto marca que el número es de esta propiedad y
                             no el de la casa. Va con `title` propio porque un
                             signo solo no se lee. -->
                        <span v-if="o.comision?.propio" class="propio"
                              title="Honorarios propios de esta propiedad">•</span>
                      </component>
                      <span v-if="o.beneficiarios.length" class="dequien"
                            :title="quienCobraCompleto(o)">
                        {{ quienCobra(o) }}
                      </span>
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
/* La celda pasó a ser una columna: el total arriba, quién cobra abajo. En fila
   los dos datos se leían como uno solo y «6 % Sofía Luna» se confunde con un
   nombre que cobra el 6 %, que no es lo que dice. */
.hon .op { flex-direction: column; align-items: flex-start; gap: 1px; }
.total { font-size: 13px; color: var(--ink); }

/* Botón sin aspecto de botón: es el número, que además se puede tocar. Un botón
   real por fila en una tabla de 25 filas compite con la fila misma, que navega. */
.hon-total {
  display: inline-flex; align-items: baseline; gap: 3px;
  padding: 0; border: 0; background: none; font: inherit;
  color: inherit; text-align: left; border-radius: var(--r-sm);
}
button.hon-total { cursor: pointer; }
button.hon-total:hover .total { text-decoration: underline; }
button.hon-total:focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; }
.propio { font-size: 13px; line-height: 1; color: var(--accent-ink); }
.dequien {
  font-size: 11px; color: var(--muted);
  max-width: 18ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
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

/* El panel «Más filtros»: mismo patrón `<details>` con flecha en el
   `::before` que ya usa el resto del repo (ver PropiedadFormPage.vue), acá con
   su propio `<style scoped>` porque `scoped` no cruza componentes. */
.ajuste { margin: calc(var(--s-sm) * -1) 0 0; }
.ajuste > summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: var(--s-sm);
  color: var(--accent-ink);
  font-size: 13px;
  list-style: none;
}
.ajuste > summary::-webkit-details-marker { display: none; }
.ajuste > summary::before { content: '▸ '; }
.ajuste[open] > summary::before { content: '▾ '; }
.ajuste > summary:focus-visible { outline: 0; box-shadow: var(--ring); border-radius: var(--r-sm); }
.mas-filtros { padding: var(--s-md) 0; border-bottom: 1px solid var(--line); }
.mas-filtros > .stack { margin-top: var(--s-md); gap: var(--s-lg); }

.grid-rangos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--s-md);
}
/* El `<span>` de la etiqueta ocupa la fila entera y los dos `<input>` van cada
   uno en su columna — así el label queda arriba y «Desde»/«Hasta» lado a lado,
   sin envolver los inputs en un `<div>` aparte en el template. */
.rango {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 6px;
  font-size: 12px;
  color: var(--muted);
}
.rango > span { grid-column: 1 / -1; color: var(--ink-2); }
.rango-simple { grid-template-columns: 1fr; max-width: 200px; }
.rango input {
  font: inherit;
  font-size: 13px;
  padding: 6px var(--s-sm);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--surface);
  color: var(--ink);
  min-width: 0;
}

.grupo-multi h3 {
  margin: 0 0 var(--s-sm);
  font-size: 13px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.subgrupo-amenities + .subgrupo-amenities { margin-top: var(--s-sm); }
.subtitulo { margin: 0 0 var(--s-2xs); font-size: 12px; color: var(--muted-2); }
.chips-check { display: flex; flex-wrap: wrap; gap: var(--s-xs); }
.chip-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px var(--s-sm);
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
}
.chip-check:has(input:checked) {
  border-color: var(--accent);
  background: var(--surface-2);
  color: var(--ink);
}
.chip-check input { accent-color: var(--accent); }
.limpiar-mas { align-self: flex-start; }

/* Cuatro columnas: la etiqueta ocupa la fila, después moneda + desde + hasta. */
.rango.con-moneda { grid-template-columns: auto 1fr 1fr; }
.rango.con-moneda select {
  font: inherit;
  font-size: 13px;
  padding: 6px var(--s-xs);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--surface);
  color: var(--ink);
}
.nota-precio {
  margin: 0;
  font-size: 12px;
  color: var(--warning);
  max-width: 70ch;
}

</style>
