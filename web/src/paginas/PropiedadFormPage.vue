<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import { ETIQUETA_TIPO } from '../dominio/formato';
import { etiquetaRol } from '../dominio/roles';
import { useAuth } from '../stores/auth';
import { useEquipo } from '../stores/equipo';

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const equipo = useEquipo();
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

/**
 * Quién captó la propiedad.
 *
 * Vive aparte del `form` porque el `for…of` de arriba copia todo lo que venga
 * de la API con el mismo nombre, y acá el valor de la ficha es un objeto
 * (`agenteCaptador: { id, nombre }`) y lo que se manda es un uuid.
 *
 * **Editable, no fijo al usuario actual**: el captador no siempre es quien
 * carga la propiedad —lo dice también la sugerencia de reparto, que llega
 * editable por lo mismo—. En una propiedad nueva viene pre-llenado con quien
 * está cargando, que es el caso más común, y `''` es «sin captador».
 *
 * Hasta ahora esta pantalla NUNCA mandaba el campo: `agente_captador_id` existía
 * desde la migración 006 y sólo lo llenaba el seed. Filtrar por un dato que
 * nadie puede cargar ni corregir es filtrar por el seed.
 */
const captadorId = ref('');

const geocodificacionDisponible = ref(false);
const guardando = ref(false);
const error = ref('');
const cargando = ref(esEdicion);

onMounted(async () => {
  void equipo.cargar();

  try {
    const caps = await api<{ geocodificacion: boolean }>('/propiedades/capacidades');
    geocodificacionDisponible.value = caps.geocodificacion;
  } catch { /* si falla, se asume sin geocodificación y se explica la carga manual */ }

  if (esEdicion) {
    try {
      const p = await api<Record<string, unknown>>(`/propiedades/${id}`);
      for (const k of Object.keys(form) as Array<keyof typeof form>) {
        const v = p[k];
        if (v !== null && v !== undefined) form[k] = String(v);
      }
      const cap = p.agenteCaptador as { id: string } | null;
      captadorId.value = cap?.id ?? '';
      latCargada.value = form.lat;
      lngCargada.value = form.lng;
    } catch (e) {
      error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la propiedad.';
    } finally {
      cargando.value = false;
    }
  } else {
    captadorId.value = auth.usuario?.id ?? '';
  }
});

function numeroOpcional(v: string): number | undefined {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? undefined : n;
}

/**
 * Las coordenadas tal como las trajo la ficha, para saber si la persona las tocó.
 *
 * Sin esto, abrir Editar y guardar cualquier otra cosa mandaba lat y lng de
 * vuelta —el formulario las pre-llena— y el backend las marcaba como carga
 * **manual**. Efecto: una coordenada que había puesto Google quedaba congelada, y
 * a partir de ahí corregir la dirección ya no la volvía a resolver. Guardar un
 * campo no puede cambiar el origen de otro.
 */
const latCargada = ref('');
const lngCargada = ref('');

/**
 * Qué se manda en `lat`/`lng`, con los tres significados del backend:
 * `undefined` = no las toques · `null` en las dos = borralas · números = son
 * éstas, cargadas a mano. Van de a dos: mandar una sola es 422, y el mensaje lo
 * dice.
 */
function ubicacionAMandar(): { lat?: number | null; lng?: number | null } {
  const sinTocar = form.lat === latCargada.value && form.lng === lngCargada.value;
  if (sinTocar) return {};

  const lat = numeroOpcional(form.lat);
  const lng = numeroOpcional(form.lng);
  return { lat: lat ?? null, lng: lng ?? null };
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
      ...ubicacionAMandar(),
      // `null` explícito y no `undefined`: en el PATCH significa DESASIGNAR.
      // Con `undefined` el backend deja lo que había —es la regla del PATCH
      // parcial— y vaciar el captador no haría nada visible.
      agenteCaptadorId: captadorId.value || null,
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
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo guardar.';
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
          <p v-if="geocodificacionDisponible" class="nota">
            La ubicación se resuelve automáticamente al guardar y se guarda una sola vez.
          </p>
          <p v-else class="nota aviso">
            La ubicación automática no está configurada (falta
            <code class="mono">GOOGLE_MAPS_API_KEY</code>). La propiedad se guarda igual, sin
            coordenadas. Podés cargarlas a mano acá abajo — el mapa de la ficha las muestra
            igual, no depende de la key.
          </p>

          <!--
            La carga manual va SIEMPRE, no sólo cuando falta la key.

            Antes vivía dentro del `v-else` de «hay mapas», así que el día que
            llegue la key estos dos campos desaparecen. Y ahí falta justo el caso
            que el propio `geocoding.service.ts` nombra: la salida manual sirve
            cuando no hay key **o cuando Google ubica mal la dirección**. Sin
            esto, `geocode_fuente = 'manual'` —que el backfill respeta a
            propósito— dejaría de poder crearse desde la app.

            Plegado porque es el caso raro cuando la geocodificación anda.
          -->
          <details class="ajuste" :open="!geocodificacionDisponible">
            <summary>Ajustar la ubicación a mano</summary>
            <p class="nota">
              <template v-if="geocodificacionDisponible">
                Si Google ubica mal la dirección, cargá las coordenadas acá: quedan marcadas
                como carga manual y ninguna sincronización posterior las pisa.
              </template>
              <template v-else>
                Se sacan de Google Maps: botón derecho sobre el punto exacto y las copia.
              </template>
              Van las dos o ninguna. Vaciar las dos borra la ubicación guardada.
            </p>
            <div class="grid">
              <label class="campo"><span>Latitud</span><input v-model="form.lat" inputmode="decimal" placeholder="-32.8908" /></label>
              <label class="campo"><span>Longitud</span><input v-model="form.lng" inputmode="decimal" placeholder="-68.8272" /></label>
            </div>
          </details>
        </div>
      </section>

      <section class="card stack">
        <h2>Captación</h2>
        <label class="campo">
          <span>Quién captó la propiedad</span>
          <select v-model="captadorId">
            <option value="">Sin captador</option>
            <option v-for="m in equipo.activos" :key="m.usuarioId" :value="m.usuarioId">
              {{ m.nombre }} · {{ etiquetaRol(m.rol, auth.tipoCuenta) }}
            </option>
          </select>
          <!-- `<p>` y no `<span>`: dentro de `.campo`, un `span` hijo directo es
               LA ETIQUETA del campo y la capa familia lo pone en mayúsculas. -->
          <p class="ayuda">
            Pre-llena el reparto de la comisión y es lo que filtran los listados por agente.
            No siempre es quien carga la propiedad, por eso se puede cambiar.
          </p>
        </label>
        <p v-if="equipo.error" class="nota aviso">{{ equipo.error }}</p>
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
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--s-md);
}
.ancho2 { grid-column: span 2; }
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
.nota.aviso {
  padding: var(--s-sm) var(--s-md);
  background: var(--warning-tint);
  border: 1px solid var(--warning-line);
  border-radius: var(--r-md);
  color: var(--warning);
}
.nota-mapa { display: flex; flex-direction: column; gap: var(--s-md); }
.ajuste > summary {
  cursor: pointer;
  color: var(--accent-ink);
  font-size: 13px;
  /* El marcador nativo cambia de forma entre navegadores y no se alinea con el
     resto. Se apaga y la flecha va en el pseudo-elemento, igual que PanelMapas. */
  list-style: none;
}
.ajuste > summary::-webkit-details-marker { display: none; }
.ajuste > summary::before { content: '▸ '; }
.ajuste[open] > summary::before { content: '▾ '; }
.ajuste > summary:focus-visible { outline: 0; box-shadow: var(--ring); border-radius: var(--r-sm); }
.ajuste > .nota { margin: var(--s-sm) 0; }
.ajuste > .grid { margin-top: var(--s-sm); }
.acciones { padding-bottom: var(--s-xl); }
</style>
