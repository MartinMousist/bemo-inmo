<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import UiIcon from '../componentes/UiIcon.vue';
import GaleriaFotos from '../componentes/GaleriaFotos.vue';
import EnlacePropietario from '../componentes/EnlacePropietario.vue';
import {
  ETIQUETA_ESTADO_OP,
  ETIQUETA_OPERACION,
  ETIQUETA_TIPO,
  money,
  numero,
} from '../dominio/formato';

interface Operacion {
  id: string; tipo: string; precio: number | null; moneda: string;
  expensas: number | null; expensasMoneda: string; estado: string;
}
interface Propiedad {
  id: string; etiqueta: string; direccion: string; tipo: string;
  lat: number | null; lng: number | null; ubicacionConocida: boolean;
  supTotal: number | null; supCubierta: number | null;
  ambientes: number | null; dormitorios: number | null; banos: number | null; cocheras: number | null;
  antiguedad: number | null; descripcion: string | null;
  operaciones: Operacion[];
  titulares: Array<{ personaId: string; nombre: string; porcentaje: number }>;
}

const route = useRoute();
const router = useRouter();
const id = route.params.id as string;

const p = ref<Propiedad | null>(null);
const cargando = ref(true);
const error = ref('');
const mapaVisible = ref(false);
const mapasDisponibles = ref(false);
const fotosDisponibles = ref(false);

const nuevaOp = reactive({ abierto: false, tipo: 'alquiler', precio: '', moneda: 'ARS' });

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const [prop, caps] = await Promise.all([
      api<Propiedad>(`/propiedades/${id}`),
      api<{ mapas: boolean; fotos: boolean }>('/propiedades/capacidades'),
    ]);
    p.value = prop;
    mapasDisponibles.value = caps.mapas;
    fotosDisponibles.value = caps.fotos;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la propiedad.';
  } finally { cargando.value = false; }
}

async function agregarOperacion() {
  error.value = '';
  try {
    const precio = Number(nuevaOp.precio);
    p.value = await api<Propiedad>(`/propiedades/${id}/operaciones`, {
      method: 'POST',
      body: JSON.stringify({
        tipo: nuevaOp.tipo,
        precio: nuevaOp.precio.trim() && !Number.isNaN(precio) ? precio : undefined,
        moneda: nuevaOp.moneda,
        estado: 'disponible',
      }),
    });
    nuevaOp.abierto = false; nuevaOp.precio = '';
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo crear la operación.';
  }
}

function tono(estado: string) {
  if (estado === 'disponible') return 'ok' as const;
  if (estado === 'reservada') return 'warn' as const;
  if (estado === 'cerrada' || estado === 'suspendida') return 'err' as const;
  return 'neutro' as const;
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <UiSkeleton v-if="cargando" :filas="3" :alto="80" />

    <template v-else-if="p">
      <PageHeader :titulo="p.direccion" :bajada="`${p.etiqueta} · ${ETIQUETA_TIPO[p.tipo] ?? p.tipo}`">
        <template #acciones>
          <RouterLink class="btn secondary" :to="`/propiedades/${p.id}/editar`">Editar</RouterLink>
        </template>
      </PageHeader>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <div class="cols">
        <div class="stack">
          <section class="card stack">
            <div class="row entre">
              <h2>Operaciones</h2>
              <button class="btn secondary sm" type="button" @click="nuevaOp.abierto = !nuevaOp.abierto">
                Agregar
              </button>
            </div>

            <form v-if="nuevaOp.abierto" class="row alta" @submit.prevent="agregarOperacion">
              <select v-model="nuevaOp.tipo">
                <option value="alquiler">Alquiler</option>
                <option value="venta">Venta</option>
                <option value="alquiler_temporario">Temporario</option>
              </select>
              <select v-model="nuevaOp.moneda"><option value="ARS">ARS</option><option value="USD">USD</option></select>
              <input v-model="nuevaOp.precio" inputmode="decimal" placeholder="Precio" />
              <button class="btn sm" type="submit">Crear</button>
            </form>

            <ul v-if="p.operaciones.length" class="ops">
              <li v-for="o in p.operaciones" :key="o.id">
                <div class="op-cab">
                  <StatusChip :texto="ETIQUETA_OPERACION[o.tipo] ?? o.tipo" tono="acento" />
                  <StatusChip :texto="ETIQUETA_ESTADO_OP[o.estado] ?? o.estado" :tono="tono(o.estado)" />
                </div>
                <p class="precio mono">{{ money(o.precio, o.moneda) }}</p>
                <p v-if="o.expensas" class="expensas mono">
                  + {{ money(o.expensas, o.expensasMoneda) }} de expensas
                </p>
              </li>
            </ul>
            <p v-else class="vacio">
              Sin operaciones. Una propiedad puede estar en venta y en alquiler a la vez.
            </p>
          </section>

          <section class="card stack">
            <h2>Características</h2>
            <dl class="datos">
              <div><dt>Sup. total</dt><dd class="mono">{{ numero(p.supTotal, ' m²') }}</dd></div>
              <div><dt>Sup. cubierta</dt><dd class="mono">{{ numero(p.supCubierta, ' m²') }}</dd></div>
              <div><dt>Ambientes</dt><dd class="mono">{{ numero(p.ambientes) }}</dd></div>
              <div><dt>Dormitorios</dt><dd class="mono">{{ numero(p.dormitorios) }}</dd></div>
              <div><dt>Baños</dt><dd class="mono">{{ numero(p.banos) }}</dd></div>
              <div><dt>Cocheras</dt><dd class="mono">{{ numero(p.cocheras) }}</dd></div>
              <div><dt>Antigüedad</dt><dd class="mono">{{ numero(p.antiguedad, ' años') }}</dd></div>
            </dl>
            <p v-if="p.descripcion" class="desc">{{ p.descripcion }}</p>
          </section>
        </div>

        <div class="stack">
          <section class="card stack">
            <h2>Ubicación</h2>

            <!-- Static Maps en la ficha; el interactivo sólo bajo demanda.
                 Google cobra por carga: un mapa interactivo en cada ficha
                 multiplica la factura sin que nadie lo note. -->
            <template v-if="p.ubicacionConocida && mapasDisponibles">
              <div v-if="!mapaVisible" class="mapa-placeholder">
                <UiIcon nombre="mapa" :tam="24" />
                <p class="mono coords">{{ p.lat!.toFixed(5) }}, {{ p.lng!.toFixed(5) }}</p>
                <button class="btn secondary sm" type="button" @click="mapaVisible = true">
                  Ver el mapa
                </button>
              </div>
              <iframe
                v-else
                class="mapa"
                loading="lazy"
                referrerpolicy="no-referrer-when-downgrade"
                :src="`https://www.google.com/maps?q=${p.lat},${p.lng}&z=16&output=embed`"
                title="Ubicación de la propiedad"
              />
            </template>

            <div v-else-if="p.ubicacionConocida" class="mapa-placeholder">
              <UiIcon nombre="mapa" :tam="24" />
              <p class="mono coords">{{ p.lat!.toFixed(5) }}, {{ p.lng!.toFixed(5) }}</p>
              <p class="nota">Coordenadas cargadas a mano. El mapa necesita la API key de Google.</p>
            </div>

            <div v-else class="mapa-placeholder">
              <UiIcon nombre="mapa" :tam="24" />
              <p class="nota">
                Sin ubicación.
                <template v-if="!mapasDisponibles">
                  Falta configurar <code class="mono">GOOGLE_MAPS_API_KEY</code>; podés cargar
                  latitud y longitud a mano desde Editar.
                </template>
                <template v-else>No se pudo resolver la dirección.</template>
              </p>
            </div>
          </section>

          <GaleriaFotos :propiedad-id="p.id" :habilitado="fotosDisponibles" />

          <section class="card stack">
            <h2>Titulares</h2>
            <ul v-if="p.titulares.length" class="titulares">
              <li v-for="t in p.titulares" :key="t.personaId">
                <div class="quien">
                  <span>{{ t.nombre }}</span>
                  <span class="mono pct">{{ t.porcentaje }}%</span>
                </div>
                <!-- Acá está el dueño: es el lugar natural para darle acceso. -->
                <EnlacePropietario :persona-id="t.personaId" :nombre="t.nombre" />
              </li>
            </ul>
            <p v-else class="vacio">Sin titulares cargados.</p>
          </section>
        </div>
      </div>

      <button class="btn secondary sm volver" type="button" @click="router.push('/propiedades')">
        <UiIcon nombre="volver" :tam="14" /> Volver al listado
      </button>
    </template>
  </div>
</template>

<style scoped>
.cols { display: grid; grid-template-columns: 1.4fr 1fr; gap: var(--s-lg); align-items: start; }
@media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }

.row.entre { justify-content: space-between; }
.btn.sm { padding: 4px var(--s-md); font-size: 12px; }

.alta select, .alta input {
  font: inherit; font-size: 13px; padding: var(--s-xs) var(--s-sm);
  border: 1px solid var(--line-strong); border-radius: var(--r-sm);
  background: var(--surface); color: var(--ink);
}
.alta input { flex: 1; min-width: 90px; }

.ops { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-md); }
.ops li { padding: var(--s-md); background: var(--surface-2); border-radius: var(--r-md); }
.op-cab { display: flex; gap: var(--s-xs); margin-bottom: var(--s-xs); }
.precio { margin: 0; font-size: 17px; color: var(--ink); }
.expensas { margin: 2px 0 0; font-size: 12px; color: var(--muted); }

.datos { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--s-md); margin: 0; }
.datos dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted-2); }
.datos dd { margin: 2px 0 0; color: var(--ink); }
.desc { margin: 0; color: var(--ink-2); font-size: 13px; white-space: pre-wrap; }

.mapa-placeholder {
  display: flex; flex-direction: column; align-items: center; gap: var(--s-sm);
  padding: var(--s-xl); background: var(--surface-2);
  border: 1px dashed var(--line-strong); border-radius: var(--r-md); color: var(--muted);
  text-align: center;
}
.coords { margin: 0; font-size: 12px; color: var(--ink-2); }
.nota { margin: 0; font-size: 12px; color: var(--muted); max-width: 40ch; }
.mapa { width: 100%; height: 260px; border: 1px solid var(--line); border-radius: var(--r-md); }

.titulares { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-sm); }
.titulares li { display: flex; flex-direction: column; font-size: 13px; color: var(--ink-2); }
.titulares .quien { display: flex; justify-content: space-between; gap: var(--s-md); }
.pct { color: var(--muted); }
.vacio { margin: 0; color: var(--muted-2); font-size: 13px; }
.volver { align-self: flex-start; display: inline-flex; align-items: center; gap: var(--s-xs); }
</style>
