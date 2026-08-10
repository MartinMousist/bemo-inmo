<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useUi } from '../stores/ui';
import StatusChip from './StatusChip.vue';
import { fecha } from '../dominio/formato';

/**
 * El acta de entrega y la de devolución.
 *
 * Es la fuente número uno de conflicto de un alquiler: al devolver el depósito
 * nadie se acuerda de cómo estaba la cocina hace tres años.
 *
 * Tres decisiones de esta pantalla:
 *
 * **Lo primero que se ve es la comparación, no las actas.** Cuando existen las
 * dos, arriba de todo va «2 ambientes volvieron peor de como se entregaron».
 * Quien abre esto tiene al inquilino enfrente esperando el depósito.
 *
 * **Firmar pide confirmación y dice que es para siempre.** Es irreversible por
 * trigger, así que el diálogo no es ceremonia: es la última oportunidad de
 * agregar la foto que falta.
 *
 * **Un acta sin fotos se puede firmar, y la pantalla lo desaconseja.** No se
 * bloquea: hay entregas que se hacen sin teléfono a mano, y un sistema que se
 * niega a registrar lo que pasó obliga a no registrarlo en ningún lado.
 */

const props = defineProps<{ contratoId: string }>();
const emit = defineEmits<{ cambio: [] }>();
const ui = useUi();

interface Foto { id: string; url: string; nombreOriginal: string | null }
interface Item {
  id: string; ambiente: string; estado: string; detalle: string | null;
  fotos: number; fotosDetalle: Foto[];
}
interface Acta {
  id: string; tipo: 'entrega' | 'devolucion'; tipoTexto: string; fecha: string;
  presentes: string | null; observaciones: string | null;
  medidores: { luz: string | null; gas: string | null; agua: string | null };
  llavesEntregadas: number | null;
  firmada: boolean; firmadaEl: string | null; firmadaInquilino: string | null;
  items: Item[]; pendientes: string[];
}
interface Comparacion {
  items: Array<{
    ambiente: string; veredicto: string; resumen: string;
    entrega: Item | null; devolucion: Item | null;
  }>;
  empeoraron: number; sinComparacion: number; titular: string;
}
interface Estado {
  entrega: Acta | null; devolucion: Acta | null;
  comparacion: Comparacion | null; ambientesSugeridos: string[];
}

const ESTADOS = [
  { clave: 'excelente', texto: 'Excelente' },
  { clave: 'bueno', texto: 'Bueno' },
  { clave: 'regular', texto: 'Regular' },
  { clave: 'malo', texto: 'Malo' },
];

const TONO: Record<string, 'ok' | 'warn' | 'err' | 'neutro'> = {
  excelente: 'ok', bueno: 'ok', regular: 'warn', malo: 'err',
};

const estado = ref<Estado | null>(null);
const cargando = ref(true);
const error = ref('');
const trabajando = ref('');
const nuevoAmbiente = ref<Record<string, string>>({});

const comparacion = computed(() => estado.value?.comparacion ?? null);

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    estado.value = await api<Estado>(`/contratos/${props.contratoId}/actas`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar las actas.';
  } finally { cargando.value = false; }
}

async function accion(clave: string, fn: () => Promise<Estado>) {
  trabajando.value = clave;
  try {
    estado.value = await fn();
    emit('cambio');
  } catch (e) {
    ui.error('No se pudo', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally { trabajando.value = ''; }
}

const crear = (tipo: 'entrega' | 'devolucion') =>
  accion(`crear-${tipo}`, () =>
    api<Estado>(`/contratos/${props.contratoId}/actas`, {
      method: 'POST',
      body: JSON.stringify({
        tipo,
        // La de devolución copia los ambientes de la entrega en el servidor:
        // mandar los sugeridos acá los haría incomparables.
        items: tipo === 'entrega'
          ? (estado.value?.ambientesSugeridos ?? []).map((a) => ({ ambiente: a, estado: 'bueno' }))
          : undefined,
      }),
    }));

function guardarItems(acta: Acta, items: Item[]) {
  return accion(`items-${acta.id}`, () =>
    api<Estado>(`/actas/${acta.id}/items`, {
      method: 'PUT',
      body: JSON.stringify({
        items: items.map((i) => ({
          ambiente: i.ambiente, estado: i.estado, detalle: i.detalle ?? undefined,
        })),
      }),
    }));
}

function cambiarEstado(acta: Acta, item: Item, valor: string) {
  guardarItems(acta, acta.items.map((i) => (i.id === item.id ? { ...i, estado: valor } : i)));
}

function agregarAmbiente(acta: Acta) {
  const nombre = (nuevoAmbiente.value[acta.id] ?? '').trim();
  if (!nombre) return;
  nuevoAmbiente.value[acta.id] = '';
  guardarItems(acta, [...acta.items, { ambiente: nombre, estado: 'bueno' } as Item]);
}

function quitarAmbiente(acta: Acta, item: Item) {
  guardarItems(acta, acta.items.filter((i) => i.id !== item.id));
}

async function subirFoto(item: Item, ev: Event) {
  const input = ev.target as HTMLInputElement;
  const archivo = input.files?.[0];
  if (!archivo) return;

  await accion(`foto-${item.id}`, async () => {
    const datos = await new Promise<string>((res, rej) => {
      const l = new FileReader();
      l.onload = () => res(String(l.result));
      l.onerror = () => rej(new Error('No se pudo leer el archivo'));
      l.readAsDataURL(archivo);
    });
    return api<Estado>(`/actas/items/${item.id}/fotos`, {
      method: 'POST',
      body: JSON.stringify({ datos, nombre: archivo.name }),
    });
  });
  input.value = '';
}

async function firmar(acta: Acta) {
  const quien = window.prompt(
    'Firma del inquilino: ¿quién firma? (nombre y aclaración)',
  );
  if (!quien?.trim()) return;

  const ok = await ui.confirmar({
    titulo: `¿Firmar el ${acta.tipoTexto.toLowerCase()}?`,
    detalle:
      'Una vez firmada, el acta no se modifica más: ni los ambientes, ni los estados, ' +
      'ni las fotos. Es lo que la hace servir como prueba.' +
      (acta.pendientes.length ? ` Ojo: ${acta.pendientes.join(' ')}` : ''),
    confirmar: 'Firmar',
  });
  if (!ok) return;

  await accion(`firmar-${acta.id}`, () =>
    api<Estado>(`/actas/${acta.id}/firmar`, {
      method: 'POST',
      body: JSON.stringify({ firmadaInquilino: quien.trim() }),
    }));
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="cargando" class="nota">Cargando…</p>

    <template v-else-if="estado">
      <!-- La comparación va PRIMERO: quien abre esto tiene al inquilino
           enfrente esperando el depósito. -->
      <section v-if="comparacion" class="card comparacion stack">
        <header class="row">
          <strong>{{ comparacion.titular }}</strong>
          <StatusChip
            :texto="comparacion.empeoraron ? `${comparacion.empeoraron} con daño` : 'Sin daños'"
            :tono="comparacion.empeoraron ? 'err' : 'ok'" />
        </header>

        <table class="comp">
          <thead>
            <tr><th>Ambiente</th><th>Entrega</th><th>Devolución</th><th>Qué pasó</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in comparacion.items" :key="c.ambiente"
              :class="{ mal: c.veredicto === 'empeoro' }">
              <th scope="row">{{ c.ambiente }}</th>
              <td>
                <StatusChip v-if="c.entrega" :texto="c.entrega.estado" :tono="TONO[c.entrega.estado]" />
                <span v-else class="nada">—</span>
              </td>
              <td>
                <StatusChip v-if="c.devolucion" :texto="c.devolucion.estado" :tono="TONO[c.devolucion.estado]" />
                <span v-else class="nada">—</span>
              </td>
              <td class="que">{{ c.resumen }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Las dos actas, una al lado de la otra -->
      <div class="dos">
        <section v-for="tipo in (['entrega', 'devolucion'] as const)" :key="tipo" class="card acta stack">
          <header class="row">
            <strong>{{ tipo === 'entrega' ? 'Acta de entrega' : 'Acta de devolución' }}</strong>
            <StatusChip
              v-if="estado[tipo]"
              :texto="estado[tipo]!.firmada ? `Firmada ${fecha(estado[tipo]!.firmadaEl)}` : 'Sin firmar'"
              :tono="estado[tipo]!.firmada ? 'ok' : 'warn'" />
          </header>

          <template v-if="!estado[tipo]">
            <p class="nota">
              {{ tipo === 'entrega'
                ? 'Todavía no se hizo. Arranca con los ambientes de siempre y se ajusta recorriendo.'
                : 'Se hace al devolver la unidad, y copia los ambientes de la entrega para poder compararlos.' }}
            </p>
            <button class="btn secondary sm" type="button"
              :disabled="trabajando === `crear-${tipo}` || (tipo === 'devolucion' && !estado.entrega)"
              @click="crear(tipo)">
              {{ tipo === 'entrega' ? 'Hacer el acta de entrega' : 'Hacer el acta de devolución' }}
            </button>
            <p v-if="tipo === 'devolucion' && !estado.entrega" class="nota">
              Primero tiene que existir la de entrega: sin ella no hay con qué comparar.
            </p>
          </template>

          <template v-else>
            <ul v-if="estado[tipo]!.pendientes.length" class="pendientes">
              <li v-for="p in estado[tipo]!.pendientes" :key="p">{{ p }}</li>
            </ul>

            <ul class="ambientes">
              <li v-for="i in estado[tipo]!.items" :key="i.id">
                <div class="cab">
                  <span class="nombre">{{ i.ambiente }}</span>
                  <select
                    :value="i.estado"
                    :disabled="estado[tipo]!.firmada"
                    :aria-label="`Estado de ${i.ambiente}`"
                    @change="cambiarEstado(estado[tipo]!, i, ($event.target as HTMLSelectElement).value)"
                  >
                    <option v-for="e in ESTADOS" :key="e.clave" :value="e.clave">{{ e.texto }}</option>
                  </select>
                  <button v-if="!estado[tipo]!.firmada" class="btn secondary sm" type="button"
                    @click="quitarAmbiente(estado[tipo]!, i)">Quitar</button>
                </div>

                <div class="fotos">
                  <a v-for="f in i.fotosDetalle" :key="f.id" :href="f.url" target="_blank"
                    rel="noopener" class="mini">
                    <img :src="f.url" :alt="`${i.ambiente} — foto`" loading="lazy" />
                  </a>
                  <label v-if="!estado[tipo]!.firmada" class="agregar-foto">
                    <span>+ foto</span>
                    <input type="file" accept="image/*" @change="subirFoto(i, $event)" />
                  </label>
                </div>
              </li>
            </ul>

            <form v-if="!estado[tipo]!.firmada" class="row" @submit.prevent="agregarAmbiente(estado[tipo]!)">
              <input v-model="nuevoAmbiente[estado[tipo]!.id]" maxlength="120"
                placeholder="Agregar un ambiente…" :aria-label="`Agregar ambiente al ${tipo}`" />
              <button class="btn secondary sm" type="submit">Agregar</button>
            </form>

            <div v-if="!estado[tipo]!.firmada" class="row">
              <button class="btn sm" type="button"
                :disabled="trabajando === `firmar-${estado[tipo]!.id}`"
                @click="firmar(estado[tipo]!)">Firmar</button>
            </div>
            <p v-else class="nota">
              Firmada por {{ estado[tipo]!.firmadaInquilino }}. No se modifica más: lo que
              aparezca después va como observación nueva, con su fecha.
            </p>
          </template>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.nota { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.6; max-width: 68ch; }
.row { display: flex; align-items: center; gap: var(--s-sm); flex-wrap: wrap; }
.pendientes { margin: 0; padding-left: 1.2em; font-size: 12px; color: var(--warning); line-height: 1.7; }

.comparacion { border-color: var(--line-strong); }
.comp { width: 100%; border-collapse: collapse; font-size: 13px; }
.comp th, .comp td { padding: var(--s-xs) var(--s-sm); text-align: left; border-bottom: 1px solid var(--line); }
.comp thead th { font-size: 12px; color: var(--muted); font-weight: 500; }
.comp tbody th { font-weight: 500; }
.comp .mal th, .comp .mal .que { color: var(--danger); }
.que { color: var(--ink-2); }
.nada { color: var(--muted); }

.dos { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--s-lg); }
.acta { min-width: 0; }
.ambientes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-md); }
.ambientes > li { border-bottom: 1px solid var(--line); padding-bottom: var(--s-md); }
.ambientes > li:last-child { border-bottom: none; }
.cab { display: flex; align-items: center; gap: var(--s-sm); }
.nombre { margin-right: auto; font-size: 13px; }
.fotos { display: flex; gap: var(--s-xs); flex-wrap: wrap; margin-top: var(--s-sm); }
.mini { width: 56px; height: 44px; border-radius: var(--r-sm); overflow: hidden; border: 1px solid var(--line); }
.mini img { width: 100%; height: 100%; object-fit: cover; display: block; }
.agregar-foto {
  width: 56px; height: 44px; display: flex; align-items: center; justify-content: center;
  border: 1px dashed var(--line); border-radius: var(--r-sm); font-size: 11px;
  color: var(--muted); cursor: pointer;
}
.agregar-foto input { display: none; }
</style>
