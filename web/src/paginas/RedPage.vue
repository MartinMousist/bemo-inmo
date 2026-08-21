<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { useAuth } from '../stores/auth';
import { ETIQUETA_TIPO, money } from '../dominio/formato';

/**
 * La Red entre inmobiliarias.
 *
 * ── Por qué esta pantalla dice cuántas inmobiliarias hay ──
 *
 * Una red con una sola inmobiliaria no es una red. Si el buscador devuelve cero
 * y no explica por qué, parece un sistema roto. Por eso arriba de todo va el
 * pulso: cuántas propiedades y de cuántas inmobiliarias. Cuando está vacío, lo
 * dice con todas las letras.
 *
 * ── Las dos mitades ──
 *
 * «Buscar» es lo que traen los demás; «Lo que ofrezco» es lo que uno pone. Son
 * dos trabajos distintos —uno es vender, el otro es decidir qué se muestra— y
 * mezclarlos en una sola tabla obligaría a leer una columna para saber de qué
 * lado está cada fila.
 */

interface Ficha {
  id: string; codigo: string; tipo: string; zona: string;
  ambientes: number | null; dormitorios: number | null; banos: number | null;
  supTotal: number | null; operacion: string;
  precio: number | null; moneda: string;
  comisionPct: number | null; inmobiliaria: string;
}

interface Mia {
  id: string; codigo: string; tipo: string; zona: string;
  operacion: string | null; precio: number | null; moneda: string | null;
  comisionPct: number | null; desde: string;
}

const auth = useAuth();
const esJefe = () => auth.rol === 'owner' || auth.rol === 'admin';

const solapa = ref<'buscar' | 'mias'>('buscar');
const pulso = ref({ propiedades: 0, inmobiliarias: 0 });
const resultados = ref<Ficha[]>([]);
const mias = ref<Mia[]>([]);
const cargando = ref(true);
const error = ref('');

const filtros = ref({ operacion: '', tipo: '', localidad: '', precioMax: '' });

const TIPOS = ['departamento', 'casa', 'ph', 'local', 'oficina', 'galpon', 'terreno'];

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const q = new URLSearchParams();
    if (filtros.value.operacion) q.set('operacion', filtros.value.operacion);
    if (filtros.value.tipo) q.set('tipo', filtros.value.tipo);
    if (filtros.value.localidad) q.set('localidad', filtros.value.localidad);
    if (filtros.value.precioMax) q.set('precioMax', filtros.value.precioMax);

    const [p, r, m] = await Promise.all([
      api<{ propiedades: number; inmobiliarias: number }>('/red/pulso'),
      api<Ficha[]>(`/red?${q}`),
      esJefe() ? api<Mia[]>('/red/mias') : Promise.resolve([] as Mia[]),
    ]);
    pulso.value = p; resultados.value = r; mias.value = m;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la Red.';
  } finally { cargando.value = false; }
}

async function bajar(id: string) {
  try {
    await api(`/red/propiedades/${id}`, {
      method: 'PUT', body: JSON.stringify({ compartida: false }),
    });
    await cargar();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo bajar de la Red.';
  }
}

const precio = (p: number | null, m: string | null) =>
  p === null ? 'Consultar' : money(p, m ?? 'ARS');

/** Sin resultados PERO con red poblada es distinto de una red vacía. */
const redVacia = computed(() => pulso.value.propiedades === 0);

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="La Red"
      bajada="Propiedades que otras inmobiliarias comparten, y lo que vos ofrecés a cambio." />

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <!-- El pulso primero. Es lo que evita que una red vacía parezca un error. -->
    <div class="pulso">
      <strong>{{ pulso.propiedades }}</strong>
      <span>{{ pulso.propiedades === 1 ? 'propiedad disponible' : 'propiedades disponibles' }}
        de {{ pulso.inmobiliarias }}
        {{ pulso.inmobiliarias === 1 ? 'inmobiliaria' : 'inmobiliarias' }}</span>
    </div>

    <nav class="solapas">
      <button type="button" :class="{ act: solapa === 'buscar' }" @click="solapa = 'buscar'">
        Buscar
      </button>
      <button v-if="esJefe()" type="button" :class="{ act: solapa === 'mias' }"
        @click="solapa = 'mias'">
        Lo que ofrezco <span v-if="mias.length" class="pill">{{ mias.length }}</span>
      </button>
    </nav>

    <template v-if="solapa === 'buscar'">
      <form class="filtros card" @submit.prevent="cargar">
        <label class="campo">
          <span>Operación</span>
          <select v-model="filtros.operacion">
            <option value="">Cualquiera</option>
            <option value="venta">Venta</option>
            <option value="alquiler">Alquiler</option>
          </select>
        </label>
        <label class="campo">
          <span>Tipo</span>
          <select v-model="filtros.tipo">
            <option value="">Cualquiera</option>
            <option v-for="t in TIPOS" :key="t" :value="t">{{ ETIQUETA_TIPO[t] ?? t }}</option>
          </select>
        </label>
        <label class="campo">
          <span>Localidad</span>
          <input v-model="filtros.localidad" placeholder="Godoy Cruz" maxlength="80" />
        </label>
        <label class="campo">
          <span>Precio hasta</span>
          <input v-model="filtros.precioMax" type="number" min="0" placeholder="150000" />
        </label>
        <button class="btn" type="submit">Buscar</button>
      </form>

      <UiSkeleton v-if="cargando" :filas="3" :alto="72" />

      <UiEmpty
        v-else-if="redVacia"
        titulo="Todavía no hay nadie más en la Red"
        detalle="La Red muestra lo que comparten OTRAS inmobiliarias. Cuando haya más cuentas ofreciendo propiedades, van a aparecer acá. Mientras tanto, podés ir marcando las tuyas para estar listo el día que se llene." />

      <UiEmpty
        v-else-if="!resultados.length"
        titulo="Ninguna propiedad coincide"
        detalle="Hay propiedades en la Red, pero ninguna con estos filtros. Probá ampliando la zona o el precio." />

      <div v-else class="fichas">
        <article v-for="f in resultados" :key="f.id" class="card ficha">
          <div class="fila">
            <strong>{{ f.zona }}</strong>
            <!-- La comisión ofrecida es lo primero que mira un asesor: define
                 si le conviene mostrarla. Por eso va destacada y no en una
                 columna al final. -->
            <span v-if="f.comisionPct !== null" class="comision">
              {{ f.comisionPct }}% para vos
            </span>
            <span v-else class="comision neutra">Comisión a convenir</span>
          </div>
          <p class="datos">
            {{ ETIQUETA_TIPO[f.tipo] ?? f.tipo }} · {{ f.operacion }}
            <template v-if="f.ambientes"> · {{ f.ambientes }} amb.</template>
            <template v-if="f.supTotal"> · {{ f.supTotal }} m²</template>
          </p>
          <div class="fila pie">
            <strong class="precio">{{ precio(f.precio, f.moneda) }}</strong>
            <span class="de">{{ f.inmobiliaria }}</span>
          </div>
        </article>
      </div>
    </template>

    <template v-else>
      <UiSkeleton v-if="cargando" :filas="2" :alto="60" />

      <UiEmpty
        v-else-if="!mias.length"
        titulo="No estás ofreciendo ninguna propiedad"
        detalle="Desde la ficha de cualquier propiedad podés compartirla en la Red y decir qué porcentaje de tu comisión ofrecés a quien traiga el comprador." />

      <table v-else class="tabla">
        <thead>
          <tr>
            <th>Propiedad</th><th>Precio</th><th>Comisión que ofrezco</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in mias" :key="m.id">
            <td>
              <RouterLink :to="`/propiedades/${m.id}`">{{ m.zona }}</RouterLink>
              <small>{{ m.codigo }} · {{ ETIQUETA_TIPO[m.tipo] ?? m.tipo }}</small>
            </td>
            <td>{{ precio(m.precio, m.moneda) }}</td>
            <td>{{ m.comisionPct !== null ? `${m.comisionPct}%` : 'A convenir' }}</td>
            <td class="der">
              <button class="btn tenue" type="button" @click="bajar(m.id)">Bajar de la Red</button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.pulso {
  display: flex; align-items: baseline; gap: .5rem;
  padding: .75rem 1rem; border-radius: var(--radio, 10px);
  background: var(--fondo-sutil, #f6f7f9);
}
.pulso strong { font-size: 1.5rem; }
.pulso span { color: var(--texto-tenue, #667); }

.solapas { display: flex; gap: .25rem; border-bottom: 1px solid var(--borde, #e3e5ea); }
.solapas button {
  background: none; border: 0; padding: .6rem 1rem; cursor: pointer;
  color: var(--texto-tenue, #667); border-bottom: 2px solid transparent;
}
.solapas button.act { color: var(--texto, #111); border-bottom-color: var(--acento, #2b6cb0); }
.pill {
  background: var(--fondo-sutil, #eef); border-radius: 999px;
  padding: 0 .4rem; font-size: .75rem; margin-left: .3rem;
}

.filtros { display: flex; gap: .75rem; flex-wrap: wrap; align-items: flex-end; }

.fichas { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.ficha { display: grid; gap: .4rem; }
.fila { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; }
.comision {
  font-weight: 600; color: var(--ok-texto, #256029); white-space: nowrap;
}
.comision.neutra { color: var(--texto-tenue, #667); font-weight: 400; }
.datos { color: var(--texto-tenue, #667); margin: 0; font-size: .9rem; }
.precio { font-size: 1.1rem; }
.de { color: var(--texto-tenue, #667); font-size: .85rem; }
.der { text-align: right; }
td small { display: block; color: var(--texto-tenue, #667); }
</style>
