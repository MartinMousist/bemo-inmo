<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import StatusChip from './StatusChip.vue';

/**
 * Estado de la integración con Google Maps.
 *
 * Aparece SÓLO cuando hay algo que hacer: falta la key, la key no funciona, o
 * hay propiedades sin ubicar. Con todo en orden no ocupa lugar — un panel de
 * "todo bien" permanente es ruido en una pantalla de trabajo.
 */
interface Diagnostico {
  configurado: boolean;
  funciona: boolean;
  estado: string;
  detalle: string;
  mensajeDeGoogle?: string;
}
interface Resultado {
  pendientes: number;
  procesadas: number;
  resueltas: number;
  resultados: Array<{ id: string; etiqueta: string; direccion: string; motivo: string }>;
}

const emit = defineEmits<{ (e: 'sincronizado'): void }>();

const auth = useAuth();
const diag = ref<Diagnostico | null>(null);
const pendientes = ref(0);
const fallidas = ref<Resultado['resultados']>([]);
const cargando = ref(true);
const trabajando = ref(false);
const ui = useUi();

/** Sólo titular y administración: son los que pueden tocar la configuración. */
const puedeVer = () => auth.rol === 'owner' || auth.rol === 'admin';

async function cargar() {
  if (!puedeVer()) { cargando.value = false; return; }
  try {
    const [d, p] = await Promise.all([
      api<Diagnostico>('/propiedades/geocoding/diagnostico'),
      api<{ pendientes: number }>('/propiedades/geocoding/pendientes'),
    ]);
    diag.value = d;
    pendientes.value = p.pendientes;
  } catch {
    // Si el diagnóstico falla, el panel no se muestra. Un error acá no puede
    // tapar el listado de propiedades, que es lo que la persona vino a ver.
    diag.value = null;
  } finally {
    cargando.value = false;
  }
}

async function sincronizar() {
  trabajando.value = true;
  fallidas.value = [];
  try {
    const r = await api<Resultado>('/propiedades/geocoding/sincronizar', { method: 'POST' });
    pendientes.value = Math.max(0, r.pendientes - r.resueltas);
    fallidas.value = r.resultados;

    if (r.resueltas) {
      ui.ok(
        `${r.resueltas} propiedad(es) ubicada(s)`,
        pendientes.value ? `quedan ${pendientes.value} por resolver` : 'no queda ninguna',
      );
      emit('sincronizado');
    } else {
      ui.info('Ninguna se pudo ubicar', 'Revisá las direcciones de la lista de abajo.');
    }
  } catch (e) {
    ui.error(
      'No se pudo sincronizar',
      e instanceof ApiError ? e.detail : 'Error inesperado',
    );
  } finally {
    trabajando.value = false;
  }
}

onMounted(cargar);
</script>

<template>
  <section
    v-if="!cargando && diag && (!diag.funciona || pendientes > 0)"
    class="card panel"
    :class="{ roto: diag.configurado && !diag.funciona }"
  >
    <header>
      <h2>Mapas</h2>
      <StatusChip
        :texto="diag.funciona ? 'Google conectado' : diag.configurado ? 'Con problema' : 'Sin configurar'"
        :tono="diag.funciona ? 'ok' : diag.configurado ? 'err' : 'warn'"
      />
    </header>

    <p class="detalle">{{ diag.detalle }}</p>

    <!-- El mensaje crudo de Google es lo único que dice CUÁL API falta
         habilitar o QUÉ restricción rebotó. Se muestra tal cual. -->
    <pre v-if="diag.mensajeDeGoogle" class="mono google">{{ diag.mensajeDeGoogle }}</pre>

    <p v-if="!diag.configurado" class="como">
      Se crea en Google Cloud: habilitar <b>Geocoding API</b>, activar la
      facturación del proyecto, y restringir la key <b>por IP</b> (no por
      referrer HTTP: las consultas salen del servidor, no del navegador).
      Después va en <code class="mono">GOOGLE_MAPS_API_KEY</code> del
      <code class="mono">.env</code> y se reinicia la API.
    </p>

    <template v-if="pendientes > 0">
      <p class="pendientes">
        <b>{{ pendientes }}</b> propiedad(es) sin ubicación.
        <template v-if="diag.funciona">
          Se resuelven de a 50 por vez — cada consulta a Google se paga.
        </template>
        <template v-else>
          Se pueden ubicar a mano desde cada ficha, con latitud y longitud.
        </template>
      </p>

      <button
        v-if="diag.funciona"
        class="btn"
        type="button"
        :disabled="trabajando"
        @click="sincronizar"
      >
        {{ trabajando ? 'Consultando a Google…' : `Ubicar ${Math.min(pendientes, 50)}` }}
      </button>
    </template>

    <div v-if="fallidas.length" class="fallidas">
      <p>Estas no se pudieron ubicar:</p>
      <ul>
        <li v-for="f in fallidas" :key="f.id">
          <RouterLink :to="`/propiedades/${f.id}`">
            <span class="mono cod">{{ f.etiqueta }}</span>
            <span>{{ f.direccion }}</span>
          </RouterLink>
          <span class="motivo">{{ f.motivo }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
  align-items: flex-start;
  background: var(--warning-tint);
  border-color: var(--warning-line);
}
.panel.roto { background: var(--danger-tint); border-color: var(--danger-line); }

header { display: flex; align-items: center; gap: var(--s-md); }
h2 {
  margin: 0;
  font-family: var(--font-title);
  font-size: 16px;
  font-weight: 500;
  color: var(--ink);
}

.detalle, .como, .pendientes {
  margin: 0;
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.5;
  max-width: 76ch;
}
.como { color: var(--muted); }
.como code, .cod { font-size: 12px; }

.google {
  margin: 0;
  padding: var(--s-sm) var(--s-md);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  font-size: 12px;
  color: var(--muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-width: 100%;
}

.fallidas { font-size: 13px; width: 100%; }
.fallidas > p { margin: 0 0 var(--s-sm); color: var(--muted); }
.fallidas ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-xs); }
.fallidas li { display: flex; gap: var(--s-md); flex-wrap: wrap; align-items: baseline; }
.fallidas a { display: flex; gap: var(--s-sm); align-items: baseline; color: var(--ink); text-decoration: none; }
.fallidas a:hover { text-decoration: underline; }
.cod { color: var(--muted); }
.motivo { color: var(--muted); font-size: 12px; }
</style>
