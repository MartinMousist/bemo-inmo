<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import { pct } from '../dominio/comisiones';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import UiIcon from '../componentes/UiIcon.vue';
import GaleriaFotos from '../componentes/GaleriaFotos.vue';
import EnlacePropietario from '../componentes/EnlacePropietario.vue';
import {
  ETIQUETA_OPERACION,
  ETIQUETA_TIPO,
  etiquetaSituacion,
  fecha,
  money,
  numero,
  tonoSituacion,
} from '../dominio/formato';

interface Operacion {
  id: string; tipo: string; precio: number | null; moneda: string;
  expensas: number | null; expensasMoneda: string; estado: string;
  /** Los honorarios de ESTA operación. `propio: false` = los de la casa. */
  comision: { puntas: Record<string, number>; total: number; propio: boolean } | null;
  /** El reparto ya hecho: quién cobra qué. Vacío hasta que la operación cierra. */
  beneficiarios: Array<{
    nombre: string; tipo: string; punta: string | null;
    porcentaje: number; monto: number; moneda: string; estado: string;
  }>;
}
interface Propiedad {
  id: string; etiqueta: string; direccion: string; tipo: string;
  lat: number | null; lng: number | null; ubicacionConocida: boolean;
  /** `'manual'`, `'google'` o `null`. Decide qué dice el pie del mapa. */
  geocodeFuente: string | null;
  geocodeEl: string | null;
  supTotal: number | null; supCubierta: number | null;
  ambientes: number | null; dormitorios: number | null; banos: number | null; cocheras: number | null;
  antiguedad: number | null; descripcion: string | null;
  agenteCaptador: { id: string; nombre: string } | null;
  operaciones: Operacion[];
  titulares: Array<{ personaId: string; nombre: string; porcentaje: number }>;
}

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const ui = useUi();
const id = route.params.id as string;

const p = ref<Propiedad | null>(null);
const cargando = ref(true);
const error = ref('');
const mapaVisible = ref(false);
/**
 * Dos capacidades y no una.
 *
 * `geocodificacion` es «el servidor puede resolver una dirección» y necesita la
 * API key. `mapaEmbebido` es «se puede mostrar el mapa de una coordenada» y NO
 * la necesita: el iframe va a `www.google.com/maps?…&output=embed`. Estaban
 * juntas en un solo booleano `mapas`, y por eso una propiedad ubicada a mano
 * decía que le faltaba la key.
 *
 * `mapaEmbebido` arranca en `false` y lo enciende la respuesta: si `capacidades`
 * no contesta, se muestran las coordenadas y el enlace, que es lo que siempre
 * funciona.
 */
const geocodificacionDisponible = ref(false);
const mapaEmbebido = ref(false);
const fotosDisponibles = ref(false);

const nuevaOp = reactive({ abierto: false, tipo: 'alquiler', precio: '', moneda: 'ARS' });

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const [prop, caps] = await Promise.all([
      api<Propiedad>(`/propiedades/${id}`),
      api<{ geocodificacion: boolean; mapaEmbebido: boolean; fotos: boolean }>(
        '/propiedades/capacidades',
      ),
    ]);
    p.value = prop;
    geocodificacionDisponible.value = caps.geocodificacion;
    mapaEmbebido.value = caps.mapaEmbebido;
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

/**
 * Los honorarios de la operación, acá y no sólo en el listado.
 *
 * En el listado la columna se esconde abajo de 760px —cuatro columnas con un
 * editor adentro no entran en un teléfono, y la tarjeta recorta con `clip`, así
 * que ni siquiera se podría scrollear hasta ella—. Este es el lugar donde el
 * dato se edita desde el celular, y de paso donde se ve junto al precio.
 *
 * Cambiar el % NO recalcula un reparto ya hecho: pre-llena las operaciones
 * nuevas. Rehacer uno existente es el botón del detalle de la venta, que además
 * se bloquea si hay algo cobrado.
 */
const puedeEditarComision = computed(() => auth.rol === 'owner' || auth.rol === 'admin');

/**
 * Qué porción del total se lleva esta línea.
 *
 * NO se muestra el `porcentaje` que viene en la fila: el reparto es en cascada
 * y cada nivel se calcula sobre una base distinta. En una venta compartida real
 * las filas dicen 40 %, 70 % y 30 % —40 % del bruto para la otra inmobiliaria,
 * y 70/30 de lo que queda—, y puestos en una columna se leen como si sumaran
 * 140 %. Los montos, en cambio, suman exactamente el bruto de la punta, así que
 * la proporción se saca de ahí y el total da 100.
 */
function parteDelTotal(o: Operacion, b: Operacion['beneficiarios'][number]): number {
  const total = o.beneficiarios
    .filter((x) => x.moneda === b.moneda)
    .reduce((a, x) => a + x.monto, 0);
  return total ? (b.monto / total) * 100 : 0;
}

/** ¿Queda alguna operación cuyo reparto todavía no se hizo? */
const faltaRepartir = computed(
  () => (p.value?.operaciones ?? []).some((o) => !o.beneficiarios.length),
);

/**
 * El estado de una comisión, en color.
 *
 * `cobrada` en verde y `proyectada` en neutro y no al revés: lo proyectado es
 * una expectativa, y pintarlo como un logro hace que un reparto sin cobrar se
 * lea como plata que ya entró.
 */
function tonoComision(estado: string): 'ok' | 'warn' | 'neutro' {
  if (estado === 'cobrada') return 'ok';
  if (estado === 'devengada') return 'warn';
  return 'neutro';
}
const editandoComision = ref<string | null>(null);
const borradorComision = ref({ a: '', b: '' });
const guardandoComision = ref(false);

function puntasDe(o: Operacion): Array<{ clave: string; etiqueta: string; valor: number }> {
  const q = o.comision?.puntas ?? {};
  return o.tipo === 'venta'
    ? [
        { clave: 'compradora', etiqueta: 'compradora', valor: q.compradora ?? 0 },
        { clave: 'vendedora', etiqueta: 'vendedora', valor: q.vendedora ?? 0 },
      ]
    : [
        { clave: 'locataria', etiqueta: 'locataria', valor: q.locataria ?? 0 },
        { clave: 'locadora', etiqueta: 'locadora', valor: q.locadora ?? 0 },
      ];
}

function abrirComision(o: Operacion) {
  editandoComision.value = o.id;
  const [a, b] = puntasDe(o);
  borradorComision.value = { a: String(a.valor), b: String(b.valor) };
}

const comisionExcede = computed(
  () => Number(borradorComision.value.a || 0) + Number(borradorComision.value.b || 0) > 100,
);

async function guardarComision(o: Operacion, heredar = false) {
  guardandoComision.value = true; error.value = '';
  try {
    const cuerpo = heredar
      ? {}
      : o.tipo === 'venta'
        ? { venta: { compradora: Number(borradorComision.value.a), vendedora: Number(borradorComision.value.b) } }
        : { alquiler: { locataria: Number(borradorComision.value.a), locadora: Number(borradorComision.value.b) } };

    p.value = await api<Propiedad>(`/propiedades/${id}/operaciones/${o.id}/comisiones`, {
      method: 'PATCH',
      body: JSON.stringify(cuerpo),
    });
    editandoComision.value = null;
    ui.ok(
      heredar ? 'Vuelve a heredar' : 'Honorarios guardados',
      heredar
        ? 'Esta operación usa de nuevo los de la inmobiliaria.'
        : 'Sólo afecta a esta operación.',
    );
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron guardar los honorarios.';
  } finally { guardandoComision.value = false; }
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
                  <!-- «Cerrada» no es lo mismo en una venta que en un
                       alquiler: en un alquiler ese estado es la unidad
                       ALQUILADA. La etiqueta y el tono salen de `formato.ts`
                       —eran una copia local, la tercera— y `o.tipo` ya está
                       acá al lado. -->
                  <StatusChip
                    :texto="etiquetaSituacion(o.estado, o.tipo)"
                    :tono="tonoSituacion(o.estado)"
                  />
                </div>
                <p class="precio mono">{{ money(o.precio, o.moneda) }}</p>
                <p v-if="o.expensas" class="expensas mono">
                  + {{ money(o.expensas, o.expensasMoneda) }} de expensas
                </p>

                <div class="honorarios">
                  <template v-if="editandoComision === o.id">
                    <label class="mini">
                      <span>{{ puntasDe(o)[0].etiqueta }}</span>
                      <input
                        v-model="borradorComision.a" class="pct" inputmode="decimal"
                        :aria-label="`Punta ${puntasDe(o)[0].etiqueta}`"
                        @keydown.enter.prevent="guardarComision(o)"
                        @keydown.esc="editandoComision = null" />
                    </label>
                    <label class="mini">
                      <span>{{ puntasDe(o)[1].etiqueta }}</span>
                      <input
                        v-model="borradorComision.b" class="pct" inputmode="decimal"
                        :aria-label="`Punta ${puntasDe(o)[1].etiqueta}`"
                        @keydown.enter.prevent="guardarComision(o)"
                        @keydown.esc="editandoComision = null" />
                    </label>
                    <button class="btn sm" type="button"
                            :disabled="guardandoComision || comisionExcede"
                            @click="guardarComision(o)">OK</button>
                    <button class="btn secondary sm" type="button"
                            @click="editandoComision = null">Cancelar</button>
                    <button v-if="o.comision?.propio" class="btn secondary sm" type="button"
                            :disabled="guardandoComision" @click="guardarComision(o, true)">
                      Volver a heredar
                    </button>
                    <p v-if="comisionExcede" class="alert" role="alert">
                      Las dos puntas no pueden sumar más del 100 %.
                    </p>
                  </template>

                  <template v-else>
                    <span class="hon-et">Honorarios</span>
                    <span class="mono hon-total">{{ pct(o.comision?.total ?? 0) }}</span>
                    <span class="hon-detalle">
                      {{ puntasDe(o).map((x) => `${x.etiqueta} ${x.valor}`).join(' + ') }}
                      · {{ o.comision?.propio ? 'de esta propiedad' : 'de la inmobiliaria' }}
                    </span>
                    <button v-if="puedeEditarComision" class="btn secondary sm" type="button"
                            @click="abrirComision(o)">
                      Cambiar
                    </button>
                  </template>
                </div>

                <!-- De quién es la comisión.
                     El porcentaje de arriba dice cuánto cobra la inmobiliaria;
                     esto dice quién se lo lleva, que es otra pregunta y la que
                     genera las discusiones. Aparece recién cuando la operación
                     cerró y el reparto existe: antes, lo único cierto es el
                     captador, y de eso habla el párrafo del final. -->
                <ul v-if="o.beneficiarios.length" class="reparto">
                  <li v-for="(b, i) in o.beneficiarios" :key="i">
                    <span class="quien">
                      {{ b.nombre }}
                      <span v-if="b.tipo === 'inmobiliaria_externa'" class="externa">
                        otra inmobiliaria
                      </span>
                    </span>
                    <span class="parte mono">{{ money(b.monto, b.moneda) }}</span>
                    <span class="pct-parte mono">{{ pct(parteDelTotal(o, b)) }}</span>
                    <StatusChip :texto="b.estado" :tono="tonoComision(b.estado)" />
                  </li>
                </ul>
              </li>
            </ul>
            <p v-else class="vacio">
              Sin operaciones. Una propiedad puede estar en venta y en alquiler a la vez.
            </p>

            <!-- La explicación del captador es sobre lo que VA a pasar, así que
                 sólo tiene sentido si queda alguna operación por repartir. Con
                 todo cerrado y el reparto arriba en pantalla, prometer que ese
                 nombre «pre-llena el reparto» contradice lo que se está viendo. -->
            <p class="vacio">
              <template v-if="p.agenteCaptador">
                Captó <strong>{{ p.agenteCaptador.nombre }}</strong
                ><template v-if="faltaRepartir">: es quien pre-llena el
                reparto de la comisión, como valor por defecto editable</template>.
              </template>
              <template v-else>
                <strong>Sin captador cargado.</strong> Se carga desde Editar, y es lo que
                pre-llena el reparto de la comisión cuando se cierra la operación.
              </template>
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

            <!--
              El mapa depende de que HAYA coordenadas, y de nada más.

              Antes estaba detrás de `mapasDisponibles`, que era «el servidor
              tiene key para geocodificar». Son dos cosas distintas: el iframe va
              a `www.google.com/maps?…&output=embed`, que **no lleva key**
              (verificado desde el contenedor: HTTP 200, sin `X-Frame-Options`).
              Con la key mezclada, una propiedad con lat/lng cargadas a mano
              mostraba «El mapa necesita la API key de Google» y escondía un mapa
              que funcionaba.

              El interactivo sigue bajo demanda: aunque esta URL no se factura,
              cargar un mapa en cada ficha es peso que nadie pidió.
            -->
            <template v-if="p.ubicacionConocida && mapaEmbebido">
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

            <!-- Degradación: hay coordenadas pero el embebido está apagado.
                 Esa URL no está documentada por Google —lo documentado es Maps
                 Embed API, que sí lleva key—, así que es una dependencia sin
                 contrato: el día que deje de andar se apaga `mapaEmbebido` en el
                 backend y la ficha muestra las coordenadas y un enlace, en vez
                 de un recuadro roto. -->
            <div v-else-if="p.ubicacionConocida" class="mapa-placeholder">
              <UiIcon nombre="mapa" :tam="24" />
              <p class="mono coords">{{ p.lat!.toFixed(5) }}, {{ p.lng!.toFixed(5) }}</p>
              <a
                class="btn secondary sm"
                :href="`https://www.google.com/maps?q=${p.lat},${p.lng}`"
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir en Google Maps
              </a>
            </div>

            <div v-else class="mapa-placeholder">
              <UiIcon nombre="mapa" :tam="24" />
              <p class="nota">
                Sin ubicación.
                <template v-if="!geocodificacionDisponible">
                  La ubicación automática no está configurada (falta
                  <code class="mono">GOOGLE_MAPS_API_KEY</code>); podés cargar latitud y
                  longitud a mano desde Editar y el mapa aparece igual.
                </template>
                <template v-else>
                  No se pudo resolver la dirección. Se puede cargar a mano desde Editar.
                </template>
              </p>
            </div>

            <!--
              De dónde salió el punto. No es un detalle de sistema: decide qué
              pasa con él. Una coordenada cargada a mano sobrevive a un cambio de
              dirección y ninguna sincronización la pisa; una de Google se vuelve
              a resolver sola. Sin decirlo, las dos reglas son magia.
            -->
            <p v-if="p.ubicacionConocida" class="nota origen">
              <template v-if="p.geocodeFuente === 'manual'">
                Coordenadas cargadas a mano{{ p.geocodeEl ? ` el ${fecha(p.geocodeEl)}` : '' }}.
                No las pisa ninguna sincronización.
              </template>
              <template v-else-if="p.geocodeFuente === 'google'">
                Ubicada por Google{{ p.geocodeEl ? ` el ${fecha(p.geocodeEl)}` : '' }} a partir de
                la dirección.
              </template>
              <template v-else>
                Sin registro de cómo se cargó: la propiedad es anterior a que se guardara.
              </template>
            </p>
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
.honorarios {
  display: flex; align-items: flex-end; gap: var(--s-sm); flex-wrap: wrap;
  margin-top: var(--s-sm); padding-top: var(--s-sm); border-top: 1px solid var(--line);
}
.hon-et { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-2); }
.hon-total { font-size: 13px; color: var(--ink); }
.hon-detalle { font-size: 11px; color: var(--muted); flex: 1; min-width: 12ch; }

/* El reparto: una línea por persona, el monto alineado a la derecha para que
   dos importes se puedan comparar de un vistazo sin leerlos. */
.reparto { list-style: none; margin: var(--s-sm) 0 0; padding: 0; }
.reparto li {
  display: flex; align-items: center; gap: var(--s-sm);
  padding: var(--s-2xs) 0; font-size: 13px;
}
.reparto li + li { border-top: 1px dashed var(--line); }
.quien { flex: 1; min-width: 0; color: var(--ink); }
.externa {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--muted-2); margin-left: var(--s-xs);
}
.parte { font-variant-numeric: tabular-nums; }
.pct-parte { font-size: 11px; color: var(--muted); min-width: 5ch; text-align: right; }
.mini { display: flex; flex-direction: column; gap: 2px; }
.mini > span { font-size: 10px; color: var(--muted-2); }
.pct {
  width: 6ch; font: inherit; font-size: 12px; text-align: right;
  padding: 2px var(--s-sm); border: 1px solid var(--line-strong);
  border-radius: var(--r-sm); background: var(--surface); color: var(--ink);
}
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
/* El origen de la coordenada es pie de dato, no un aviso: va debajo del mapa
   y en el mismo gris que el resto de las notas. */
.origen { max-width: none; }
.mapa { width: 100%; height: 260px; border: 1px solid var(--line); border-radius: var(--r-md); }

.titulares { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-sm); }
.titulares li { display: flex; flex-direction: column; font-size: 13px; color: var(--ink-2); }
.titulares .quien { display: flex; justify-content: space-between; gap: var(--s-md); }
.pct { color: var(--muted); }
.vacio { margin: 0; color: var(--muted-2); font-size: 13px; }
.volver { align-self: flex-start; display: inline-flex; align-items: center; gap: var(--s-xs); }
</style>
