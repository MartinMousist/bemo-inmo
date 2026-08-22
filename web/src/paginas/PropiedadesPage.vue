<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, descargar } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import { pct } from '../dominio/comisiones';
import PageHeader from '../componentes/PageHeader.vue';
import PanelMapas from '../componentes/PanelMapas.vue';
import PropiedadFila from '../componentes/PropiedadFila.vue';
import PropiedadesGrilla from '../componentes/PropiedadesGrilla.vue';
import SearchInput from '../componentes/SearchInput.vue';
import FiltrosPropiedades from '../componentes/FiltrosPropiedades.vue';
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
  plural,
  numero,
  tonoSituacion,
} from '../dominio/formato';
import { hayFiltroDeAgente, paramsDeAgente } from '../dominio/agente';
import { filtrosRecordados } from '../dominio/filtros';
import { guardarVista, leerVista, type Vista } from '../dominio/vista';

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
const route = useRoute();
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
  // Cerca de un punto. Los tres van juntos: el back sólo filtra con los tres.
  lat: '', lng: '', radioKm: '',
});

/** Las claves de rango/multi-select, en el orden en que se mandan a la API. */
const CAMPOS_RANGO = [
  'ambientesMin', 'ambientesMax', 'dormitoriosMin', 'dormitoriosMax',
  'banosMin', 'banosMax', 'toilettesMin', 'toilettesMax',
  'cocherasMin', 'cocherasMax', 'plantasMin', 'plantasMax', 'antiguedadMax',
  'supTotalMin', 'supTotalMax', 'supCubiertaMin', 'supCubiertaMax',
  'precioMin', 'precioMax', 'expensasMin', 'expensasMax',
  'lat', 'lng', 'radioKm',
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
 * Lo marcado.
 *
 * Vive en la pantalla y NO en `filtros`: no es un filtro y no se recuerda entre
 * visitas. Volver mañana y encontrar tres propiedades tildadas de una sesión
 * anterior sería desconcertante.
 *
 * Antes esto era «marcado para comparar» y el tope era cuatro. Ahora lo marcado
 * sirve para dos cosas —comparar y mandárselas a un cliente— así que el tope
 * sube a doce y es COMPARAR el que pide entre dos y cuatro, porque más columnas
 * no entran en la tabla. Un solo mecanismo de marcado; dos cosas para hacer con
 * él.
 */
const marcadas = ref<string[]>([]);
const MAX_MARCADAS = 12;
const MAX_COMPARAR = 4;

function alternarMarcada(id: string) {
  const i = marcadas.value.indexOf(id);
  if (i >= 0) marcadas.value.splice(i, 1);
  else if (marcadas.value.length < MAX_MARCADAS) marcadas.value.push(id);
}

/**
 * El envío al cliente.
 *
 * Se arma acá y no en una pantalla aparte porque el momento de mandar es JUSTO
 * después de elegir: mandar a otra pantalla obligaría a volver a marcar las
 * mismas propiedades.
 */
/**
 * Las propiedades que ESTA persona marcó.
 *
 * Se piden UNA vez y no por tarjeta: son ids, entran todos juntos, y el
 * listado ya trae las propiedades. Un Set porque la grilla pregunta cincuenta
 * veces por render.
 */
const favoritas = ref<Set<string>>(new Set());

async function cargarFavoritas() {
  try {
    favoritas.value = new Set(await api<string[]>('/propiedades/favoritas'));
  } catch {
    // Si falla, las tarjetas quedan sin marcar. Es un ícono: no vale romper la
    // pantalla por él.
  }
}

async function alternarFavorita(id: string, marcada: boolean) {
  // Se pinta PRIMERO y se guarda después: el corazón tiene que responder al
  // toque, no a la latencia. Si el guardado falla se revierte, que es la única
  // forma honesta de hacer esto.
  const previo = new Set(favoritas.value);
  const s = new Set(favoritas.value);
  if (marcada) s.add(id); else s.delete(id);
  favoritas.value = s;

  try {
    await api(`/propiedades/${id}/favorita`, {
      method: 'PUT', body: JSON.stringify({ marcada }),
    });
  } catch {
    favoritas.value = previo;
    ui.error('No se pudo guardar', 'La marca volvió a como estaba.');
  }
}

const abrirEnvio = ref(false);
const creandoEnvio = ref(false);
const errorEnvio = ref('');
const enlaceEnvio = ref('');
const copiado = ref(false);
/**
 * Cuántas se mandaron, congelado al crear.
 *
 * El título contaba `marcadas.length` en vivo, y como las marcas se sueltan al
 * crear el enlace, el encabezado terminaba diciendo «Enviar 0 propiedades»
 * justo cuando el envío había salido bien. Se vio abriendo la pantalla.
 */
const cantidadEnviada = ref(0);
const envio = reactive({ contactoNombre: '', titulo: '', mensaje: '' });

async function crearEnvio() {
  creandoEnvio.value = true; errorEnvio.value = '';
  try {
    const r = await api<{ token: string }>('/envios', {
      method: 'POST',
      body: JSON.stringify({
        propiedades: marcadas.value,
        contactoNombre: envio.contactoNombre || undefined,
        titulo: envio.titulo || undefined,
        mensaje: envio.mensaje || undefined,
      }),
    });
    enlaceEnvio.value = `${window.location.origin}/s/${r.token}`;
    cantidadEnviada.value = marcadas.value.length;
    // Las marcas se sueltan recién ACÁ, con el enlace ya creado: soltarlas antes
    // dejaría al asesor sin nada marcado si la creación falla.
    marcadas.value = [];
  } catch (e) {
    errorEnvio.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo crear el envío.';
  } finally { creandoEnvio.value = false; }
}

async function copiarEnlace() {
  await navigator.clipboard.writeText(enlaceEnvio.value);
  copiado.value = true;
  setTimeout(() => { copiado.value = false; }, 2000);
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

/**
 * «Buscar cerca» de la ficha entra por la URL.
 *
 * Esta pantalla recuerda sus filtros en `localStorage` y no los sincroniza con
 * la URL —es una preferencia personal, no algo que se comparta—. Pero un enlace
 * que dice «mostrame lo que está cerca de ESTA propiedad» sí es de qué se está
 * hablando, así que esos tres se leen del query UNA vez al montar.
 *
 * Van los tres o ninguno: con dos, el back ignora el filtro y la pantalla
 * mostraría todo mientras el panel dice que está filtrando.
 */
onMounted(() => {
  const { lat, lng, radioKm } = route.query;
  if (typeof lat === 'string' && typeof lng === 'string' && typeof radioKm === 'string') {
    filtros.value = { ...filtros.value, lat, lng, radioKm };
  }
  void cargar();
  void cargarFavoritas();
});
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

    <!--
      Los filtros, en UNA fila de pastillas.
      Antes eran treinta campos en una columna detrás de «Más filtros»: para
      poner un mínimo de ambientes había que reconocer un par «Desde / Hasta»
      entre otros siete pares idénticos. Ahora cada dimensión es una pastilla
      que dice lo que tiene elegido, y sólo abre sus propios campos.

      Es como filtran Zonaprop y Zillow. No es imitar por imitar: es el patrón
      que la gente de este rubro ya sabe usar sin que nadie le explique.
    -->
    <div class="barra-filtros">
      <SearchInput v-model="q" placeholder="Dirección, localidad o código…" />

      <!-- Operación queda como segmentado y no como desplegable: son tres
           opciones excluyentes y es el eje principal de la búsqueda. Esconderla
           detrás de un clic para ganar 40px sería cambiar velocidad por
           prolijidad en el control que más se usa. -->
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

      <FiltrosPropiedades v-model:filtros="filtros" :operacion="filtroOperacion" />

      <SelectAgente v-model="filtros.agente" etiqueta="Captó" con-sin-asignar />

      <button v-if="hayMasFiltros" class="limpiar-todo" type="button" @click="limpiarMasFiltros">
        Limpiar filtros
      </button>
    </div>

    <!-- «Exportar» baja SIEMPRE la cartera completa: `GET /exportar/:recurso.csv`
         no toma ningún filtro. Con una lista filtrada al lado, quien apreta cree
         que se está bajando lo que ve. Se dice, en vez de sacar el botón: bajar
         todo sigue siendo lo que la mayoría quiere. -->
    <p v-if="hayFiltro" class="aviso-exportar">
      El botón «Exportar» baja la cartera completa, no lo que está filtrado.
    </p>

    <p v-if="marcadas.length" class="barra-comparar">
      <span>{{ plural(marcadas.length, 'propiedad marcada', 'propiedades marcadas') }}</span>

      <!-- Enviar va primero y con una sola alcanza: mandarle UNA propiedad a un
           cliente es un caso normal, comparar una contra nada no lo es. -->
      <button class="btn sm" type="button" @click="abrirEnvio = true">Enviar a un cliente</button>

      <RouterLink
        v-if="marcadas.length >= 2 && marcadas.length <= MAX_COMPARAR"
        class="btn secondary sm"
        :to="`/propiedades/comparar?ids=${marcadas.join(',')}`"
      >Comparar</RouterLink>
      <span v-else-if="marcadas.length > MAX_COMPARAR" class="ayuda">
        Para comparar, marcá hasta {{ MAX_COMPARAR }}.
      </span>

      <button class="btn secondary sm" type="button" @click="marcadas = []">Quitar</button>
    </p>

    <!-- El armado del envío.
         Todo es opcional menos las propiedades: el asesor está apurado y el
         título y el mensaje tienen default. Pedirle tres campos para mandar un
         enlace haría que lo siga haciendo por capturas de pantalla. -->
    <div v-if="abrirEnvio" class="card stack envio">
      <h2 v-if="!enlaceEnvio">Enviar {{ plural(marcadas.length, 'propiedad', 'propiedades') }}</h2>
      <h2 v-else>{{ plural(cantidadEnviada, 'propiedad lista', 'propiedades listas') }} para mandar</h2>

      <template v-if="!enlaceEnvio">
        <label class="campo">
          <span>Para quién (opcional)</span>
          <input v-model="envio.contactoNombre" maxlength="120" placeholder="Familia Gómez" />
        </label>
        <label class="campo">
          <span>Título (opcional)</span>
          <input v-model="envio.titulo" maxlength="120"
            placeholder="Opciones para vos" />
        </label>
        <label class="campo">
          <span>Mensaje (opcional)</span>
          <textarea v-model="envio.mensaje" maxlength="1000" rows="2"
            placeholder="Mirá estas tres, la primera me parece la mejor."></textarea>
        </label>
        <p v-if="errorEnvio" class="alert" role="alert">{{ errorEnvio }}</p>
        <div class="acciones">
          <button class="btn" type="button" :disabled="creandoEnvio" @click="crearEnvio">
            {{ creandoEnvio ? 'Creando…' : 'Crear enlace' }}
          </button>
          <button class="btn secondary" type="button" @click="abrirEnvio = false">Cancelar</button>
        </div>
      </template>

      <template v-else>
        <p>Listo. Pegale este enlace al cliente por donde te escriba.</p>
        <div class="acciones">
          <input class="enlace" :value="enlaceEnvio" readonly @focus="($event.target as HTMLInputElement).select()" />
          <button class="btn" type="button" @click="copiarEnlace">
            {{ copiado ? 'Copiado' : 'Copiar' }}
          </button>
        </div>
        <p class="ayuda">Vas a ver si lo abrió en <RouterLink to="/envios">Envíos</RouterLink>.</p>
      </template>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <!-- En tarjetas la grilla va SUELTA, sin la tarjeta contenedora: una
         tarjeta de tarjetas es un marco alrededor de otro marco. El estado
         vacío y el error siguen entrando por el `v-else`, con el mismo copy y
         el mismo lugar en las dos vistas. -->
    <!-- La lista: una fila por propiedad, con foto. Es la vista de recorrer. -->
    <div v-if="vista === 'lista' && items.length" class="listado">
      <PropiedadFila
        v-for="p in items"
        :key="p.id"
        :propiedad="p"
        :favorita="favoritas.has(p.id)"
        @favorita="(m) => alternarFavorita(p.id, m)"
      />
    </div>

    <PropiedadesGrilla
      v-if="vista === 'tarjetas' && (cargando || items.length > 0)"
      :items="items"
      :cargando="cargando"
      :favoritas="favoritas"
      @favorita="alternarFavorita"
    />

    <div v-else-if="vista === 'tabla'" class="card sin-padding">
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
              <th><span class="visually-hidden">Comparar</span></th>
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
              <!-- `@click.stop`: la fila entera navega a la ficha, y sin esto
                   tildar para comparar abriría la propiedad. -->
              <td class="check-comparar" @click.stop @keydown.stop>
                <input
                  type="checkbox"
                  :checked="marcadas.includes(p.id)"
                  :disabled="!marcadas.includes(p.id) && marcadas.length >= MAX_MARCADAS"
                  :aria-label="`Comparar ${p.etiqueta}`"
                  @change="alternarMarcada(p.id)"
                />
              </td>
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
.check-comparar { width: 1%; }
.check-comparar input { accent-color: var(--accent); }
.barra-comparar {
  display: flex; align-items: center; gap: var(--s-md); flex-wrap: wrap;
  margin: 0; padding: var(--s-sm) var(--s-md);
  background: var(--surface-2); border-radius: var(--r-md); font-size: 13px;
}
.barra-comparar .ayuda { color: var(--muted); }
.nota-radio { margin: 0; font-size: 12px; color: var(--muted); max-width: 70ch; }

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


.envio { max-width: 34rem; }
.envio .acciones { display: flex; gap: .5rem; align-items: center; }
.envio .enlace {
  flex: 1; font-family: ui-monospace, monospace; font-size: .85rem;
}

/* ── La barra de filtros ──
   Una fila, con salto de línea cuando no entra. El buscador es lo único que
   crece: las pastillas miden lo que dicen. */
.barra-filtros {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-sm);
}
.barra-filtros > :first-child { flex: 1 1 16rem; min-width: 12rem; }

.limpiar-todo {
  background: none; border: 0; padding: 0 var(--s-sm); cursor: pointer;
  color: var(--muted); font-size: 13px; text-decoration: underline;
}
.limpiar-todo:hover { color: var(--ink-2); }

/* Dentro de un panel los rangos van uno debajo del otro y a todo el ancho: el
   panel ya es angosto, y una grilla de dos columnas ahí adentro deja campos de
   60px donde no entra «1.200». */
.filtro-panel-rango { display: grid; gap: var(--s-sm); }

.nota-panel {
  margin: 0; font-size: 12px; color: var(--muted); line-height: 1.4;
}

.listado { display: grid; gap: var(--s-md); }

/*
 * ── Al imprimir ──
 *
 * La tabla es la vista que se manda al dueño o se archiva. Lo que se va son los
 * controles —no se pueden apretar en un papel— y el fondo oscuro, que en una
 * impresora es un cartucho entero.
 */
@media print {
  .barra-filtros,
  .barra-comparar,
  .envio,
  :deep(.ph .acciones),
  :deep(.check-comparar) { display: none !important; }

  .card, :deep(.card) { border: 0; box-shadow: none; }
  :deep(table) { font-size: 10pt; }
  /* Que una fila no se corte entre dos hojas. */
  :deep(tr) { break-inside: avoid; }
}
</style>
