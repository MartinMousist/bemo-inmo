<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api, ApiError, descargar } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import SearchInput from '../componentes/SearchInput.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';

interface Persona {
  id: string; nombreCompleto: string; docTipo: string | null; docNumero: string | null;
  email: string | null; telefono: string | null; roles: string[];
}

const ETIQUETA_ROL: Record<string, string> = {
  propietario: 'Propietario', interesado: 'Interesado', reservante: 'Reservó',
};

const items = ref<Persona[]>([]);
const total = ref(0);
const q = ref('');
const cargando = ref(true);
const error = ref('');

// Alta inline: si la búsqueda parece un documento y no hay resultados, se ofrece
// crear la persona ahí mismo con el número ya cargado.
const pareceDocumento = ref(false);
const creando = ref(false);
const nuevoNombre = ref('');

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const params = new URLSearchParams({ porPagina: '50' });
    if (q.value.trim()) params.set('q', q.value.trim());
    const r = await api<{ items: Persona[]; total: number }>(`/personas?${params}`);
    items.value = r.items; total.value = r.total;
    pareceDocumento.value = /^\d{7,9}$/.test(q.value.trim()) && r.items.length === 0;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar las personas.';
  } finally { cargando.value = false; }
}

let deb: ReturnType<typeof setTimeout> | undefined;
watch(q, () => { clearTimeout(deb); deb = setTimeout(cargar, 220); });

async function crearInline() {
  try {
    await api('/personas', {
      method: 'POST',
      body: JSON.stringify({ nombre: nuevoNombre.value, docTipo: 'dni', docNumero: q.value.trim() }),
    });
    creando.value = false; nuevoNombre.value = ''; q.value = '';
    await cargar();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo crear.';
  }
}

async function exportar() {
  error.value = '';
  try { await descargar('/exportar/personas.csv'); }
  catch (e) { error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo exportar.'; }
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Personas" :bajada="cargando ? '' : `${total} registradas`">
      <template #acciones>
        <button class="btn secondary" type="button" @click="exportar">Exportar</button>
        <RouterLink class="btn" to="/personas/nueva">Nueva persona</RouterLink>
      </template>
    </PageHeader>

    <SearchInput v-model="q" placeholder="Nombre, documento, correo o teléfono…" />

    <div v-if="pareceDocumento" class="card inline">
      <p class="nota">
        No hay nadie con el documento <strong class="mono">{{ q }}</strong>. Podés darlo de alta acá mismo.
      </p>
      <form v-if="creando" class="row" @submit.prevent="crearInline">
        <input v-model="nuevoNombre" required placeholder="Nombre y apellido" autofocus />
        <button class="btn" type="submit">Crear</button>
        <button class="btn secondary" type="button" @click="creando = false">Cancelar</button>
      </form>
      <button v-else class="btn" type="button" @click="creando = true">
        Dar de alta con ese documento
      </button>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div class="card sin-padding">
      <UiSkeleton v-if="cargando" :filas="5" />
      <UiEmpty
        v-else-if="!items.length && !pareceDocumento"
        :titulo="q ? 'Nadie coincide' : 'Todavía no hay personas'"
        detalle="Propietarios, inquilinos, compradores y garantes viven todos acá. Una persona, todos sus roles."
      >
        <RouterLink v-if="!q" class="btn" to="/personas/nueva">Cargar la primera</RouterLink>
      </UiEmpty>
      <div v-else-if="items.length" class="table-wrap">
        <table>
          <thead>
            <tr><th>Nombre</th><th>Documento</th><th>Contacto</th><th>Roles</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in items" :key="p.id">
              <td class="fuerte">{{ p.nombreCompleto }}</td>
              <td class="mono">{{ p.docNumero ? `${(p.docTipo ?? '').toUpperCase()} ${p.docNumero}` : '—' }}</td>
              <td>
                <div class="contacto">
                  <span v-if="p.telefono" class="mono">{{ p.telefono }}</span>
                  <span v-if="p.email" class="mono chico">{{ p.email }}</span>
                  <span v-if="!p.telefono && !p.email" class="muted">—</span>
                </div>
              </td>
              <td>
                <div class="roles">
                  <StatusChip v-for="r in p.roles" :key="r" :texto="ETIQUETA_ROL[r] ?? r" tono="acento" />
                  <span v-if="!p.roles.length" class="muted">—</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.contacto { display: flex; flex-direction: column; gap: 2px; }
.chico { font-size: 12px; color: var(--muted); }
.roles { display: flex; gap: var(--s-xs); flex-wrap: wrap; }
.muted { color: var(--muted-2); }
.inline { display: flex; flex-direction: column; gap: var(--s-md); }
.inline input {
  flex: 1; font: inherit; padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink);
}
.nota { margin: 0; font-size: 13px; color: var(--muted); }
</style>
