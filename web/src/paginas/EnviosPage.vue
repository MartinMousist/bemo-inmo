<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha } from '../dominio/formato';

/**
 * Las selecciones que se le mandaron a cada cliente.
 *
 * ── La columna que importa ──
 *
 * «Vistas». Todo lo demás —cuándo se mandó, cuántas fichas, a quién— ya se
 * sabe. Lo que no se sabía nunca es si el cliente lo abrió, y eso es lo que
 * decide a quién llamar hoy.
 *
 * Por eso la lista se ordena por lo más reciente pero destaca lo abierto: un
 * envío mirado tres veces es un cliente enganchado.
 */

interface Envio {
  id: string; token: string; titulo: string | null; para: string;
  propiedades: number; vistas: number;
  abiertoEl: string | null; venceEl: string; vencido: boolean; creadoEl: string;
}

const lista = ref<Envio[]>([]);
const cargando = ref(true);
const error = ref('');
const copiado = ref('');

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    lista.value = await api<Envio[]>('/envios');
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los envíos.';
  } finally { cargando.value = false; }
}

const enlaceDe = (t: string) => `${window.location.origin}/s/${t}`;

async function copiar(e: Envio) {
  await navigator.clipboard.writeText(enlaceDe(e.token));
  copiado.value = e.id;
  setTimeout(() => { if (copiado.value === e.id) copiado.value = ''; }, 2000);
}

async function eliminar(e: Envio) {
  try {
    await api(`/envios/${e.id}`, { method: 'DELETE' });
    await cargar();
  } catch (err) {
    error.value = err instanceof ApiError ? err.paraMostrar : 'No se pudo eliminar.';
  }
}

/** Los que abrió el cliente y todavía no se llamó. Es la lista de hoy. */
const abiertos = computed(() => lista.value.filter((e) => e.vistas > 0 && !e.vencido));

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Envíos a clientes"
      bajada="Selecciones de propiedades compartidas por un enlace. Se ve quién las abrió.">
      <template #acciones>
        <RouterLink class="btn" to="/propiedades">Armar un envío</RouterLink>
      </template>
    </PageHeader>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <!-- Lo accionable arriba. Si hay gente que miró y nadie la llamó, eso es lo
         que hay que hacer hoy; el resto de la lista es historial. -->
    <div v-if="abiertos.length" class="aviso">
      <strong>{{ abiertos.length }}</strong>
      {{ abiertos.length === 1
        ? 'cliente abrió su selección. Es el mejor momento para llamarlo.'
        : 'clientes abrieron su selección. Es el mejor momento para llamarlos.' }}
    </div>

    <UiSkeleton v-if="cargando" :filas="3" :alto="56" />

    <UiEmpty
      v-else-if="!lista.length"
      titulo="Todavía no mandaste ninguna selección"
      detalle="Elegí propiedades desde la cartera y armá un envío. El cliente lo abre sin cuenta, y vos ves si lo miró." />

    <table v-else class="tabla">
      <thead>
        <tr>
          <th>Para</th><th>Fichas</th><th>Abrió</th><th>Vence</th><th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in lista" :key="e.id" :class="{ vencido: e.vencido }">
          <td>
            <strong>{{ e.para }}</strong>
            <small>{{ e.titulo || 'Sin título' }} · {{ fecha(e.creadoEl) }}</small>
          </td>
          <td>{{ e.propiedades }}</td>
          <td>
            <span v-if="e.vistas === 0" class="no-abrio">Todavía no</span>
            <span v-else class="abrio">
              {{ fecha(e.abiertoEl) }}
              <!-- Las veces sólo se dicen si son más de una: «1 vez» es ruido. -->
              <small v-if="e.vistas > 1">{{ e.vistas }} veces</small>
            </span>
          </td>
          <td>{{ e.vencido ? 'Vencido' : fecha(e.venceEl) }}</td>
          <td class="der">
            <button class="btn tenue" type="button" :disabled="e.vencido" @click="copiar(e)">
              {{ copiado === e.id ? 'Copiado' : 'Copiar enlace' }}
            </button>
            <button class="btn tenue" type="button" @click="eliminar(e)">Eliminar</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.aviso {
  padding: .75rem 1rem; border-radius: var(--radio, 10px);
  background: var(--ok-fondo, #edf7ed); color: var(--ok-texto, #256029);
}
td small { display: block; color: var(--texto-tenue, #667); }
.no-abrio { color: var(--texto-tenue, #99a); }
.abrio { color: var(--ok-texto, #256029); font-weight: 600; }
.abrio small { font-weight: 400; }
tr.vencido { opacity: .55; }
.der { text-align: right; white-space: nowrap; }
.der .btn + .btn { margin-left: .35rem; }
</style>
