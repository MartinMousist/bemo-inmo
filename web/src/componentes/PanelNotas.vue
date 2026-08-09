<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useUi } from '../stores/ui';
import StatusChip from './StatusChip.vue';
import UiSkeleton from './UiSkeleton.vue';
import { fecha, fechaHora } from '../dominio/formato';
import type { Pagina } from '../dominio/pagina';

/**
 * Notas de seguimiento sobre cualquier entidad.
 *
 * Es lo que hoy vive en WhatsApp. Cuando la persona que manejaba ese contrato
 * se va, la conversación se va con ella; acá queda en la cuenta, con quién la
 * escribió y cuándo.
 *
 * Una nota con fecha es un **pendiente**, no un apunte: es la diferencia entre
 * un cuaderno y un seguimiento.
 */

interface Nota {
  id: string; texto: string; tipo: string;
  recordarEl: string | null; resueltaEl: string | null;
  autor: string | null; creadaEl: string;
}

const props = withDefaults(
  defineProps<{
    entidadTipo: 'contrato_alquiler' | 'propiedad' | 'persona' | 'oportunidad';
    entidadId: string;
    /**
     * `false` cuando lo envuelve un `BloqueColapsable`. El default es `true`
     * a propósito: este panel también vive en la ficha de una propiedad y en la
     * de una persona, y ésas no se tocaron.
     */
    marco?: boolean;
  }>(),
  { marco: true },
);

/** Crear, resolver o borrar una nota cambia el conteo de la cabecera. */
const emit = defineEmits<{ cambio: [] }>();

const TIPO: Record<string, string> = {
  nota: 'Nota', llamado: 'Llamado', whatsapp: 'WhatsApp',
  email: 'Email', visita: 'Visita', reclamo: 'Reclamo',
};

const ui = useUi();
const items = ref<Nota[]>([]);
const total = ref(0);
const cargando = ref(true);
const guardando = ref(false);

const texto = ref('');
const tipo = ref('nota');
const recordarEl = ref('');

async function cargar() {
  cargando.value = true;
  try {
    const r = await api<Pagina<Nota>>(
      `/notas?entidadTipo=${props.entidadTipo}&entidadId=${props.entidadId}&porPagina=50`,
    );
    items.value = r.items;
    total.value = r.total;
  } catch (e) {
    ui.error('No se pudieron cargar las notas', e instanceof ApiError ? e.paraMostrar : '');
  } finally {
    cargando.value = false;
  }
}

async function agregar() {
  if (!texto.value.trim() || guardando.value) return;
  guardando.value = true;
  try {
    await api('/notas', {
      method: 'POST',
      body: JSON.stringify({
        entidadTipo: props.entidadTipo,
        entidadId: props.entidadId,
        texto: texto.value.trim(),
        tipo: tipo.value,
        ...(recordarEl.value ? { recordarEl: recordarEl.value } : {}),
      }),
    });
    texto.value = '';
    recordarEl.value = '';
    await cargar();
    emit('cambio');
  } catch (e) {
    ui.error('No se pudo guardar la nota', e instanceof ApiError ? e.paraMostrar : '');
  } finally {
    guardando.value = false;
  }
}

async function resolver(n: Nota) {
  try {
    await api(`/notas/${n.id}/resolver`, { method: 'POST' });
    await cargar();
    emit('cambio');
  } catch (e) {
    ui.error('No se pudo marcar como resuelta', e instanceof ApiError ? e.paraMostrar : '');
  }
}

async function borrar(n: Nota) {
  const ok = await ui.confirmar({
    titulo: '¿Borrar esta nota?',
    detalle: 'Una nota es el registro de algo que pasó. No se puede deshacer.',
    confirmar: 'Borrar la nota',
    peligroso: true,
  });
  if (!ok) return;

  try {
    await api(`/notas/${n.id}`, { method: 'DELETE' });
    await cargar();
    emit('cambio');
    ui.ok('Nota borrada');
  } catch (e) {
    ui.error('No se pudo borrar', e instanceof ApiError ? e.paraMostrar : '');
  }
}

const pendiente = (n: Nota) => n.recordarEl !== null && n.resueltaEl === null;
const vencida = (n: Nota) =>
  pendiente(n) && n.recordarEl! <= new Date().toISOString().slice(0, 10);

onMounted(cargar);
</script>

<template>
  <section class="stack" :class="{ card: marco }">
    <!-- Con `marco: false` el título y el conteo los pone el colapsable. -->
    <div v-if="marco" class="cab">
      <h2>Seguimiento</h2>
      <span v-if="!cargando" class="cuenta">{{ total }}</span>
    </div>

    <form class="alta" @submit.prevent="agregar">
      <textarea
        v-model="texto"
        rows="2"
        placeholder="Qué pasó: un llamado, un reclamo, algo que acordaste…"
        aria-label="Texto de la nota"
        @keydown.meta.enter="agregar"
        @keydown.ctrl.enter="agregar"
      />
      <div class="controles">
        <select v-model="tipo" aria-label="Tipo de nota">
          <option v-for="(t, k) in TIPO" :key="k" :value="k">{{ t }}</option>
        </select>
        <label class="recordar">
          <span>Recordar el</span>
          <input v-model="recordarEl" type="date" />
        </label>
        <button class="btn sm" type="submit" :disabled="!texto.trim() || guardando">
          {{ guardando ? 'Guardando…' : 'Agregar' }}
        </button>
      </div>
    </form>

    <UiSkeleton v-if="cargando" :filas="2" :alto="40" />

    <p v-else-if="!items.length" class="vacio">
      Todavía no hay nada anotado. Lo que se escribe acá queda en la cuenta, no
      en el teléfono de quien atendió.
    </p>

    <ul v-else class="lista">
      <li v-for="n in items" :key="n.id" :class="{ pendiente: pendiente(n) }">
        <div class="meta">
          <StatusChip :texto="TIPO[n.tipo] ?? n.tipo" tono="neutro" />
          <span class="autor">{{ n.autor ?? 'Usuario dado de baja' }}</span>
          <span class="mono cuando">{{ fechaHora(n.creadaEl) }}</span>
          <StatusChip
            v-if="pendiente(n)"
            :texto="`Recordar ${fecha(n.recordarEl)}`"
            :tono="vencida(n) ? 'err' : 'warn'"
          />
          <span v-else-if="n.recordarEl" class="resuelta">resuelta</span>
        </div>

        <p class="texto">{{ n.texto }}</p>

        <div class="acciones">
          <button v-if="pendiente(n)" class="enlace" type="button" @click="resolver(n)">
            Marcar resuelta
          </button>
          <button class="enlace peligro" type="button" @click="borrar(n)">Borrar</button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.cab { display: flex; align-items: center; gap: var(--s-sm); }
.cuenta { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }

.alta { display: flex; flex-direction: column; gap: var(--s-sm); }
textarea {
  font: inherit; font-size: 13px;
  padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink); resize: vertical;
}
textarea:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--accent); }

.controles { display: flex; gap: var(--s-sm); align-items: center; flex-wrap: wrap; }
.controles select, .controles input {
  font: inherit; font-size: 13px;
  padding: 6px var(--s-sm);
  border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink);
}
.recordar { display: inline-flex; align-items: center; gap: var(--s-xs); font-size: 12px; color: var(--muted); }
.controles .btn { margin-left: auto; }

.vacio { margin: 0; font-size: 13px; color: var(--muted); max-width: 62ch; line-height: 1.6; }

.lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.lista li { padding: var(--s-md) 0; border-bottom: 1px solid var(--line); }
/* El pendiente se marca con una barra al costado, no con fondo de color: el
   fondo compite con el texto, que es lo que hay que leer. */
.lista li.pendiente { border-left: 2px solid var(--warning); padding-left: var(--s-md); }

.meta { display: flex; align-items: center; gap: var(--s-sm); flex-wrap: wrap; }
.autor { font-size: 12px; color: var(--ink-2); }
.cuando { font-size: 11px; color: var(--muted-2); }
.resuelta { font-size: 11px; color: var(--success); }

.texto { margin: var(--s-xs) 0 0; font-size: 13px; color: var(--ink-2); line-height: 1.55; white-space: pre-wrap; }

.acciones { display: flex; gap: var(--s-md); margin-top: var(--s-xs); }
.enlace {
  font: inherit; font-size: 12px;
  border: none; background: none; padding: 0;
  color: var(--muted); cursor: pointer; text-decoration: underline;
}
.enlace:hover { color: var(--ink); }
.enlace.peligro:hover { color: var(--danger); }
</style>
