<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useUi } from '../stores/ui';
import UiIcon from './UiIcon.vue';
import StatusChip from './StatusChip.vue';

interface Foto { id: string; url: string; orden: number; esPortada: boolean }

const props = defineProps<{ propiedadId: string; habilitado: boolean }>();
const ui = useUi();

const fotos = ref<Foto[]>([]);
const cargando = ref(true);
const subiendo = ref(false);
const error = ref('');
const arrastrando = ref<string | null>(null);

async function cargar() {
  cargando.value = true;
  try { fotos.value = await api<Foto[]>(`/propiedades/${props.propiedadId}/fotos`); }
  catch (e) { error.value = e instanceof ApiError ? e.detail : 'No se pudieron cargar las fotos.'; }
  finally { cargando.value = false; }
}

async function elegir(e: Event) {
  const archivos = Array.from((e.target as HTMLInputElement).files ?? []);
  if (!archivos.length) return;
  error.value = ''; subiendo.value = true;

  for (const f of archivos) {
    try {
      const datos = await new Promise<string>((ok, mal) => {
        const l = new FileReader();
        l.onload = () => ok(String(l.result));
        l.onerror = () => mal(new Error('lectura'));
        l.readAsDataURL(f);
      });
      await api(`/propiedades/${props.propiedadId}/fotos`, {
        method: 'POST',
        body: JSON.stringify({ datos, nombre: f.name }),
      });
    } catch (e) {
      // Se informa el archivo que falló y se sigue con los demás: perder toda
      // la tanda porque una foto pesa de más sería hostil.
      error.value = `${f.name}: ${e instanceof ApiError ? e.detail : 'no se pudo subir'}`;
    }
  }

  subiendo.value = false;
  (e.target as HTMLInputElement).value = '';
  await cargar();
}

async function portada(id: string) {
  try { fotos.value = await api(`/propiedades/${props.propiedadId}/fotos/${id}/portada`, { method: 'PUT' }); }
  catch (e) { error.value = e instanceof ApiError ? e.detail : 'No se pudo cambiar la portada.'; }
}

async function borrar(id: string) {
  // Una foto borrada no vuelve: el archivo se va de S3.
  const ok = await ui.confirmar({
    titulo: '¿Borrar esta foto?',
    detalle: 'Se elimina del almacenamiento y de los avisos que la usen. No se puede deshacer.',
    confirmar: 'Borrar la foto',
    peligroso: true,
  });
  if (!ok) return;

  try {
    await api(`/propiedades/${props.propiedadId}/fotos/${id}`, { method: 'DELETE' });
    await cargar();
    ui.ok('Foto borrada');
  } catch (e) {
    const detalle = e instanceof ApiError ? e.detail : 'No se pudo borrar.';
    error.value = detalle;
    ui.error('No se pudo borrar la foto', detalle);
  }
}

async function soltar(sobre: string) {
  const desde = arrastrando.value;
  arrastrando.value = null;
  if (!desde || desde === sobre) return;

  const ids = fotos.value.map((f) => f.id);
  const i = ids.indexOf(desde);
  const j = ids.indexOf(sobre);
  ids.splice(j, 0, ...ids.splice(i, 1));

  try { fotos.value = await api(`/propiedades/${props.propiedadId}/fotos/orden`, { method: 'PUT', body: JSON.stringify({ ids }) }); }
  catch (e) { error.value = e instanceof ApiError ? e.detail : 'No se pudo reordenar.'; }
}

onMounted(cargar);
</script>

<template>
  <section class="card stack">
    <div class="row entre">
      <h2>Fotos</h2>
      <label v-if="habilitado" class="btn secondary sm">
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple @change="elegir" />
        {{ subiendo ? 'Subiendo…' : 'Agregar' }}
      </label>
    </div>

    <p v-if="!habilitado" class="aviso">
      El almacenamiento de archivos no está configurado, así que no se pueden subir fotos.
      Falta definir <code class="mono">S3_BUCKET</code>.
    </p>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <div v-if="cargando" class="sk" />

    <p v-else-if="!fotos.length && habilitado" class="vacio">
      Sin fotos. La primera que subas queda como portada, y el orden se cambia arrastrando.
    </p>

    <div v-else-if="fotos.length" class="grilla">
      <figure v-for="f in fotos" :key="f.id" class="foto" :class="{ portada: f.esPortada }"
              draggable="true"
              @dragstart="arrastrando = f.id"
              @dragover.prevent
              @drop.prevent="soltar(f.id)">
        <img :src="f.url" alt="" loading="lazy" />
        <figcaption>
          <StatusChip v-if="f.esPortada" texto="Portada" tono="acento" />
          <button v-else class="mini" type="button" @click="portada(f.id)">Portada</button>
          <button class="mini borrar" type="button" aria-label="Borrar" @click="borrar(f.id)">
            <UiIcon nombre="cerrar" :tam="13" />
          </button>
        </figcaption>
      </figure>
    </div>
  </section>
</template>

<style scoped>
h2 { font-size: 15px; }
.row.entre { justify-content: space-between; }
.btn.sm { padding: 4px var(--s-md); font-size: 12px; cursor: pointer; }
.btn input { display: none; }
.grilla { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--s-sm); }
.foto { margin: 0; position: relative; border-radius: var(--r-md); overflow: hidden; border: 1px solid var(--line); background: var(--surface-2); cursor: grab; }
.foto.portada { border-color: var(--accent-line); box-shadow: 0 0 0 2px var(--accent-tint); }
.foto img { display: block; width: 100%; aspect-ratio: 4/3; object-fit: cover; }
figcaption { display: flex; align-items: center; justify-content: space-between; gap: var(--s-xs); padding: var(--s-xs) var(--s-sm); }
.mini { font: inherit; font-size: 11px; padding: 1px 6px; border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--surface); color: var(--muted); cursor: pointer; }
.mini:hover { color: var(--accent); border-color: var(--accent-line); }
.mini.borrar:hover { color: var(--danger); border-color: var(--danger-line); }
.vacio, .aviso { margin: 0; font-size: 13px; color: var(--muted); }
.aviso { padding: var(--s-sm) var(--s-md); background: var(--warning-tint); border: 1px solid var(--warning-line); border-radius: var(--r-md); color: var(--warning); }
.sk { height: 100px; border-radius: var(--r-md); background: var(--surface-2); }
.alert { margin: 0; padding: var(--s-sm) var(--s-md); background: var(--danger-tint); border: 1px solid var(--danger-line); border-radius: var(--r-md); color: var(--danger); font-size: 13px; }
</style>
