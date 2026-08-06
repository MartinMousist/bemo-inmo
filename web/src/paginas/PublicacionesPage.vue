<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import SearchInput from '../componentes/SearchInput.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiPager from '../componentes/UiPager.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { ETIQUETA_OPERACION, fechaHora } from '../dominio/formato';
import { consulta, type Pagina } from '../dominio/pagina';

interface Publicacion {
  id: string; portal: string; estado: string; titulo: string | null;
  etiquetaPropiedad: string; direccion: string; tipoOperacion: string;
  urlPublica: string | null; ultimoSync: string | null; integracionActiva: boolean;
}
interface Aviso {
  titulo: string; precioTexto: string; descripcion: string;
  paraPegar: string; faltantes: string[];
}

const NOMBRE_PORTAL: Record<string, string> = {
  zonaprop: 'Zonaprop', argenprop: 'Argenprop', mercadolibre: 'MercadoLibre',
  properati: 'Properati', inmoup: 'Inmoup', web_propia: 'Web propia', otro: 'Otro',
};
const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Borrador', lista: 'Lista para pegar', publicada: 'Publicada',
  pausada: 'Pausada', error: 'Error', baja: 'De baja',
};
/**
 * La operación va en la fila —con la etiqueta compartida de `dominio/formato`—
 * porque sin ella una propiedad en venta Y en alquiler, que es un caso normal y
 * no un borde, muestra dos filas idénticas: mismo código, misma dirección, y lo
 * único distinto es el portal. El dato venía en la respuesta desde el primer
 * día y no se mostraba; apareció recién cuando la lista tuvo avisos de las dos
 * puntas.
 */

const POR_PAGINA = 25;

const items = ref<Publicacion[]>([]);
const total = ref(0);
const paginas = ref(1);
const pagina = ref(1);
const q = ref('');
const filtroPortal = ref('');
const feed = ref<{ token: string; url: string } | null>(null);
const abierta = ref<string | null>(null);
const aviso = ref<Aviso | null>(null);
const copiado = ref(false);
const cargando = ref(true);
const error = ref('');

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const [p, f] = await Promise.all([
      api<Pagina<Publicacion>>(
        `/publicaciones?${consulta(
          { pagina: pagina.value, porPagina: POR_PAGINA },
          { q: q.value.trim(), portal: filtroPortal.value },
        )}`,
      ),
      api<{ token: string; url: string }>('/publicaciones/feed/token').catch(() => null),
    ]);
    items.value = p.items;
    total.value = p.total;
    paginas.value = p.paginas;
    feed.value = f;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar las publicaciones.';
  } finally { cargando.value = false; }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
watch([q, filtroPortal], () => {
  clearTimeout(debounce);
  pagina.value = 1;
  // Al cambiar el filtro se cierra el detalle abierto: la fila que se estaba
  // mirando puede no estar más en la lista.
  abierta.value = null;
  debounce = setTimeout(cargar, 220);
});
watch(pagina, () => {
  abierta.value = null;
  void cargar();
});

async function abrir(id: string) {
  if (abierta.value === id) { abierta.value = null; return; }
  copiado.value = false;
  try {
    const r = await api<{ aviso: Aviso }>(`/publicaciones/${id}`);
    aviso.value = r.aviso; abierta.value = id;
  } catch (e) { error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo abrir.'; }
}

async function copiar() {
  if (!aviso.value) return;
  await navigator.clipboard.writeText(aviso.value.paraPegar);
  copiado.value = true;
  setTimeout(() => (copiado.value = false), 2500);
}

async function regenerar(id: string) {
  try { const r = await api<{ aviso: Aviso }>(`/publicaciones/${id}/regenerar`, { method: 'POST' }); aviso.value = r.aviso; }
  catch (e) { error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo regenerar.'; }
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Publicaciones"
      bajada="El aviso se arma completo y listo para pegar. La publicación automática depende de un convenio con cada portal." />

    <div v-if="feed" class="card feed">
      <div>
        <strong>Feed XML de la cartera</strong>
        <p class="nota">
          Público y estable. Se lo podés pasar a un portal o a un desarrollador sin
          depender de nosotros. Rotarlo invalida el anterior.
        </p>
      </div>
      <code class="mono url">{{ feed.url }}</code>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="filtros">
      <SearchInput v-model="q" placeholder="Título del aviso, dirección o código…" />
      <!-- `scroll`: son muchos portales y en pantalla angosta la barra scrollea
           en vez de empujar el ancho de la página. -->
      <div class="segmented scroll">
        <button type="button" :class="{ activo: filtroPortal === '' }" @click="filtroPortal = ''">
          Todos
        </button>
        <button
          v-for="(nombre, clave) in NOMBRE_PORTAL"
          :key="clave"
          type="button"
          :class="{ activo: filtroPortal === clave }"
          @click="filtroPortal = clave"
        >
          {{ nombre }}
        </button>
      </div>
    </div>

    <UiSkeleton v-if="cargando" :filas="3" :alto="64" />

    <UiEmpty
      v-else-if="!items.length && (q || filtroPortal)"
      titulo="Ningún aviso coincide"
      detalle="Probá con otro texto o sacá el filtro de portal."
    />
    <UiEmpty v-else-if="!items.length" titulo="Todavía no hay avisos armados"
      detalle="Desde una operación disponible se genera el aviso para el portal que quieras. El texto sale listo con título, precio y atributos." />

    <article v-for="p in items" v-else :key="p.id" class="card pub">
      <!--
        La fila es un `button` y no un `header` con `@click`: era lo único de
        esta pantalla que no se podía usar con el teclado, y el aviso vive
        adentro del detalle que abre. Con `div` había que agregarle `tabindex`,
        `role` y los handlers de Enter y Espacio a mano; el elemento nativo ya
        los trae y anuncia el estado con `aria-expanded`.
      -->
      <button class="fila" type="button" :aria-expanded="abierta === p.id" @click="abrir(p.id)">
        <div class="quien">
          <span class="linea">
            <span class="mono cod">{{ p.etiquetaPropiedad }}</span>
            <span class="op">{{ ETIQUETA_OPERACION[p.tipoOperacion] ?? p.tipoOperacion }}</span>
          </span>
          <span class="dir">{{ p.direccion }}</span>
        </div>
        <StatusChip :texto="NOMBRE_PORTAL[p.portal] ?? p.portal" tono="acento" />
        <StatusChip :texto="ETIQUETA_ESTADO[p.estado] ?? p.estado"
          :tono="p.estado === 'publicada' ? 'ok' : p.estado === 'error' ? 'err' : 'warn'" />
        <span v-if="!p.integracionActiva" class="modo">copiar y pegar</span>
        <span v-if="p.ultimoSync" class="mono sync">{{ fechaHora(p.ultimoSync) }}</span>
      </button>

      <div v-if="abierta === p.id && aviso" class="detalle">
        <div v-if="aviso.faltantes.length" class="faltan">
          Le falta: {{ aviso.faltantes.join(', ') }}. Se publica igual, pero rinde menos.
        </div>
        <pre class="mono texto">{{ aviso.paraPegar }}</pre>
        <div class="acciones">
          <button class="btn sm" type="button" @click="copiar">
            {{ copiado ? 'Copiado' : 'Copiar aviso' }}
          </button>
          <button class="btn secondary sm" type="button" @click="regenerar(p.id)">
            Regenerar desde la ficha
          </button>
        </div>
      </div>
    </article>

    <UiPager
      v-if="!cargando"
      v-model:pagina="pagina"
      :paginas="paginas"
      :total="total"
      :por-pagina="POR_PAGINA"
      sustantivo="avisos"
    />
  </div>
</template>

<style scoped>

.feed { display: flex; align-items: center; justify-content: space-between; gap: var(--s-lg); flex-wrap: wrap; }
.nota { margin: var(--s-xs) 0 0; font-size: 12px; color: var(--muted); max-width: 60ch; }
.url { padding: var(--s-sm) var(--s-md); background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-sm); font-size: 12px; }
.pub { padding: 0; overflow: hidden; }
/* El reset del botón: sin esto hereda fondo, borde y tipografía del navegador. */
.pub .fila { display: flex; align-items: center; gap: var(--s-md); padding: var(--s-md) var(--s-lg); cursor: pointer; flex-wrap: wrap; width: 100%; background: none; border: 0; font: inherit; color: inherit; text-align: left; }
.pub .fila:hover { background: var(--surface-2); }
.quien { display: flex; flex-direction: column; margin-right: auto; }
.linea { display: flex; align-items: baseline; gap: var(--s-sm); }
.op { font-size: 11px; color: var(--muted); }
.dir { color: var(--ink); font-size: 13px; }
.modo { font-size: 11px; color: var(--muted-2); }
.sync { font-size: 11px; color: var(--muted-2); }
.detalle { border-top: 1px solid var(--line); background: var(--surface-2); padding: var(--s-lg); }
.faltan { margin-bottom: var(--s-md); padding: var(--s-sm) var(--s-md); background: var(--warning-tint); border: 1px solid var(--warning-line); border-radius: var(--r-sm); color: var(--warning); font-size: 12px; }
.texto { margin: 0; padding: var(--s-md); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-sm); font-size: 12px; line-height: 1.7; white-space: pre-wrap; color: var(--ink-2); max-height: 320px; overflow: auto; }
.acciones { display: flex; gap: var(--s-sm); margin-top: var(--s-md); }
</style>
