<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import { ETIQUETA_TIPO } from '../dominio/formato';

const route = useRoute();
const router = useRouter();
const id = route.params.id as string | undefined;
const esEdicion = Boolean(id);

const form = reactive({
  calle: '', numero: '', piso: '', depto: '',
  localidad: '', provincia: '', cp: '',
  tipo: 'departamento',
  supTotal: '', supCubierta: '',
  ambientes: '', dormitorios: '', banos: '', cocheras: '',
  antiguedad: '', descripcion: '',
  lat: '', lng: '',
});

const mapasDisponibles = ref(false);
const guardando = ref(false);
const error = ref('');
const cargando = ref(esEdicion);

onMounted(async () => {
  try {
    const caps = await api<{ mapas: boolean }>('/propiedades/capacidades');
    mapasDisponibles.value = caps.mapas;
  } catch { /* si falla, se asume sin mapas y se ofrece carga manual */ }

  if (esEdicion) {
    try {
      const p = await api<Record<string, unknown>>(`/propiedades/${id}`);
      for (const k of Object.keys(form) as Array<keyof typeof form>) {
        const v = p[k];
        if (v !== null && v !== undefined) form[k] = String(v);
      }
    } catch (e) {
      error.value = e instanceof ApiError ? e.detail : 'No se pudo cargar la propiedad.';
    } finally {
      cargando.value = false;
    }
  }
});

function numeroOpcional(v: string): number | undefined {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? undefined : n;
}

async function guardar() {
  error.value = '';
  guardando.value = true;
  try {
    const cuerpo: Record<string, unknown> = {
      calle: form.calle,
      numero: form.numero || undefined,
      piso: form.piso || undefined,
      depto: form.depto || undefined,
      localidad: form.localidad || undefined,
      provincia: form.provincia || undefined,
      cp: form.cp || undefined,
      tipo: form.tipo,
      supTotal: numeroOpcional(form.supTotal),
      supCubierta: numeroOpcional(form.supCubierta),
      ambientes: numeroOpcional(form.ambientes),
      dormitorios: numeroOpcional(form.dormitorios),
      banos: numeroOpcional(form.banos),
      cocheras: numeroOpcional(form.cocheras),
      antiguedad: numeroOpcional(form.antiguedad),
      descripcion: form.descripcion || undefined,
      lat: numeroOpcional(form.lat),
      lng: numeroOpcional(form.lng),
    };

    const r = esEdicion
      ? await api<{ id: string }>(`/propiedades/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(cuerpo),
        })
      : await api<{ id: string }>('/propiedades', {
          method: 'POST',
          body: JSON.stringify(cuerpo),
        });

    router.replace(`/propiedades/${r.id}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.detail : 'No se pudo guardar.';
  } finally {
    guardando.value = false;
  }
}
</script>

<template>
  <div class="stack">
    <PageHeader :titulo="esEdicion ? 'Editar propiedad' : 'Nueva propiedad'" />

    <form v-if="!cargando" class="stack" @submit.prevent="guardar">
      <section class="card stack">
        <h2>Dirección</h2>
        <div class="grid">
          <label class="campo ancho2">
            <span>Calle *</span>
            <input v-model="form.calle" required maxlength="160" autofocus />
          </label>
          <label class="campo"><span>Número</span><input v-model="form.numero" maxlength="20" /></label>
          <label class="campo"><span>Piso</span><input v-model="form.piso" maxlength="20" /></label>
          <label class="campo"><span>Depto</span><input v-model="form.depto" maxlength="20" /></label>
          <label class="campo"><span>Localidad</span><input v-model="form.localidad" maxlength="80" /></label>
          <label class="campo"><span>Provincia</span><input v-model="form.provincia" maxlength="60" /></label>
          <label class="campo"><span>CP</span><input v-model="form.cp" maxlength="12" /></label>
        </div>

        <div class="nota-mapa">
          <p v-if="mapasDisponibles" class="nota">
            La ubicación se resuelve automáticamente al guardar y se guarda una sola vez.
          </p>
          <template v-else>
            <p class="nota aviso">
              El mapa no está configurado (falta <code class="mono">GOOGLE_MAPS_API_KEY</code>).
              La propiedad se guarda igual, sin ubicación. Podés cargar las coordenadas a mano.
            </p>
            <div class="grid">
              <label class="campo"><span>Latitud</span><input v-model="form.lat" inputmode="decimal" placeholder="-32.8908" /></label>
              <label class="campo"><span>Longitud</span><input v-model="form.lng" inputmode="decimal" placeholder="-68.8272" /></label>
            </div>
          </template>
        </div>
      </section>

      <section class="card stack">
        <h2>Características</h2>
        <div class="grid">
          <label class="campo">
            <span>Tipo *</span>
            <select v-model="form.tipo" required>
              <option v-for="(t, k) in ETIQUETA_TIPO" :key="k" :value="k">{{ t }}</option>
            </select>
          </label>
          <label class="campo"><span>Sup. total (m²)</span><input v-model="form.supTotal" inputmode="decimal" /></label>
          <label class="campo"><span>Sup. cubierta (m²)</span><input v-model="form.supCubierta" inputmode="decimal" /></label>
          <label class="campo"><span>Ambientes</span><input v-model="form.ambientes" inputmode="numeric" /></label>
          <label class="campo"><span>Dormitorios</span><input v-model="form.dormitorios" inputmode="numeric" /></label>
          <label class="campo"><span>Baños</span><input v-model="form.banos" inputmode="numeric" /></label>
          <label class="campo"><span>Cocheras</span><input v-model="form.cocheras" inputmode="numeric" /></label>
          <label class="campo"><span>Antigüedad (años)</span><input v-model="form.antiguedad" inputmode="numeric" /></label>
        </div>
        <label class="campo">
          <span>Descripción</span>
          <textarea v-model="form.descripcion" rows="4" maxlength="5000" />
        </label>
      </section>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <div class="row acciones">
        <button class="btn" type="submit" :disabled="guardando">
          {{ guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear propiedad' }}
        </button>
        <button class="btn secondary" type="button" @click="router.back()">Cancelar</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
h2 { font-size: 15px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--s-md);
}
.ancho2 { grid-column: span 2; }
.campo { display: flex; flex-direction: column; gap: var(--s-xs); }
.campo > span {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.campo input,
.campo select,
.campo textarea {
  font: inherit;
  padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
}
.campo textarea { resize: vertical; }
.nota { margin: 0; font-size: 12px; color: var(--muted-2); }
.nota.aviso {
  padding: var(--s-sm) var(--s-md);
  background: var(--warning-tint);
  border: 1px solid var(--warning-line);
  border-radius: var(--r-md);
  color: var(--warning);
}
.nota-mapa { display: flex; flex-direction: column; gap: var(--s-md); }
.acciones { padding-bottom: var(--s-xl); }
.btn:disabled { opacity: 0.6; cursor: default; }
.alert {
  margin: 0;
  padding: var(--s-sm) var(--s-md);
  background: var(--danger-tint);
  border: 1px solid var(--danger-line);
  border-radius: var(--r-md);
  color: var(--danger);
  font-size: 13px;
}
</style>
