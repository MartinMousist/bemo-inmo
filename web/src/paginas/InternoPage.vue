<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { useAuth } from '../stores/auth';
import { useEquipo } from '../stores/equipo';
import { fechaHora } from '../dominio/formato';

/**
 * Mensajes entre la gente de la oficina.
 *
 * ── Qué NO es ──
 *
 * No es la Bandeja. Aquélla habla con gente de afuera por WhatsApp, mail o
 * Instagram, y tiene canales, bot y plantillas. Esto es adentro y no tiene
 * nada de eso: dos columnas, hilos a la izquierda y mensajes a la derecha.
 *
 * ── Lo único que la otra no tiene ──
 *
 * La referencia: «mirá esta propiedad» con el enlace adentro. Sin eso, esto es
 * un WhatsApp peor —el WhatsApp ya lo tienen y funciona—; con eso, es donde se
 * pasa el trabajo.
 */

interface Hilo {
  id: string; conQuien: string; ultimoTexto: string | null;
  ultimoEl: string; sinLeer: number;
}
interface Mensaje {
  id: string; texto: string; autor: string; mio: boolean;
  refTipo: string | null; refId: string | null; el: string;
}

/** Adónde lleva cada referencia. Sin pantalla propia, al listado. */
const DESTINO: Record<string, (id: string) => string> = {
  propiedad: (id) => `/propiedades/${id}`,
  contrato: (id) => `/contratos/${id}`,
  persona: (id) => `/personas/${id}/cuenta`,
  liquidacion: () => '/liquidaciones',
  reclamo: () => '/reclamos',
  aviso: () => '/avisos',
};
const ETIQUETA_REF: Record<string, string> = {
  propiedad: 'Ver la propiedad', contrato: 'Ver el contrato',
  persona: 'Ver la persona', liquidacion: 'Ver liquidaciones',
  reclamo: 'Ver reclamos', aviso: 'Ver avisos',
};

const hilos = ref<Hilo[]>([]);
const mensajes = ref<Mensaje[]>([]);
const abierto = ref<string | null>(null);
const cargando = ref(true);
const error = ref('');
const texto = ref('');
const enviando = ref(false);
const nuevoCon = ref('');
const fondo = ref<HTMLElement>();

const hiloAbierto = computed(() => hilos.value.find((h) => h.id === abierto.value) ?? null);

const auth = useAuth();
const equipo = useEquipo();

/** El equipo menos uno mismo: escribirse a sí mismo no es una conversación. */
const companeros = computed(() =>
  equipo.activos.filter((m) => m.usuarioId !== auth.usuario?.id));

async function cargarHilos() {
  try { hilos.value = await api<Hilo[]>('/interno/hilos'); }
  catch (e) { error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar.'; }
  finally { cargando.value = false; }
}

async function abrir(id: string) {
  abierto.value = id;
  try {
    mensajes.value = await api<Mensaje[]>(`/interno/hilos/${id}`);
    // Al fondo: una conversación se lee por el final, no por el principio.
    await nextTick();
    if (fondo.value) fondo.value.scrollTop = fondo.value.scrollHeight;
    await cargarHilos();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo abrir.';
  }
}

async function enviar() {
  if (!abierto.value || !texto.value.trim()) return;
  enviando.value = true;
  const cuerpo = texto.value;
  // Se limpia ANTES de que vuelva el servidor: quien escribe ya empezó a
  // pensar el siguiente mensaje. Si falla, se devuelve el texto.
  texto.value = '';
  try {
    await api(`/interno/hilos/${abierto.value}`, {
      method: 'POST', body: JSON.stringify({ texto: cuerpo }),
    });
    await abrir(abierto.value);
  } catch (e) {
    texto.value = cuerpo;
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo enviar.';
  } finally { enviando.value = false; }
}

async function abrirCon(usuarioId: string) {
  if (!usuarioId) return;
  try {
    const r = await api<{ id: string }>('/interno/hilos', {
      method: 'POST', body: JSON.stringify({ conQuienes: [usuarioId] }),
    });
    nuevoCon.value = '';
    await cargarHilos();
    await abrir(r.id);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo abrir la conversación.';
  }
}

let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  void equipo.cargar();
  void cargarHilos();
  // Cada 20 segundos. No hay push: es una oficina de cinco personas, no un
  // chat de miles, y una conexión abierta permanente para eso no se paga.
  timer = setInterval(() => {
    void cargarHilos();
    if (abierto.value) void abrir(abierto.value);
  }, 20_000);
});
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Mensajes"
      bajada="Entre la gente de la oficina. Para hablar con un inquilino o un interesado está la Bandeja.">
      <template #acciones>
        <!--
          Selector propio y no `SelectAgente`.

          Aquél es un FILTRO: ofrece «Toda la inmobiliaria» y «yo», que como
          destinatarios de un mensaje no son nadie. Una opción que al elegirla
          no hace nada es peor que no tenerla.
        -->
        <label class="campo a-quien">
          <span>Escribirle a</span>
          <select v-model="nuevoCon" @change="abrirCon(nuevoCon)">
            <option value="">Elegí a alguien…</option>
            <option v-for="m in companeros" :key="m.usuarioId" :value="m.usuarioId">
              {{ m.nombre }}
            </option>
          </select>
        </label>
      </template>
    </PageHeader>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <UiSkeleton v-if="cargando" :filas="3" :alto="64" />

    <UiEmpty
      v-else-if="!hilos.length"
      titulo="Todavía no hay conversaciones"
      detalle="Elegí arriba a quién escribirle. Podés pasarle una propiedad, un contrato o una persona con el enlace adentro." />

    <div v-else class="dos">
      <aside class="lista">
        <button
          v-for="h in hilos"
          :key="h.id"
          type="button"
          class="hilo"
          :class="{ act: h.id === abierto }"
          @click="abrir(h.id)"
        >
          <span class="fila">
            <strong>{{ h.conQuien }}</strong>
            <span v-if="h.sinLeer" class="pendiente">{{ h.sinLeer }}</span>
          </span>
          <span v-if="h.ultimoTexto" class="ultimo">{{ h.ultimoTexto }}</span>
        </button>
      </aside>

      <section class="charla card">
        <p v-if="!abierto" class="elegir">Elegí una conversación.</p>

        <template v-else>
          <header class="cab">{{ hiloAbierto?.conQuien }}</header>

          <div ref="fondo" class="mensajes">
            <div v-for="m in mensajes" :key="m.id" class="msj" :class="{ mio: m.mio }">
              <span v-if="!m.mio" class="quien">{{ m.autor }}</span>
              <p class="texto">{{ m.texto }}</p>
              <!-- La referencia como enlace de verdad: es lo que hace que esto
                   sirva para pasar trabajo y no sólo para charlar. -->
              <RouterLink
                v-if="m.refTipo && m.refId"
                class="ref"
                :to="DESTINO[m.refTipo]?.(m.refId) ?? '/'"
              >{{ ETIQUETA_REF[m.refTipo] ?? 'Ver' }}</RouterLink>
              <span class="cuando">{{ fechaHora(m.el) }}</span>
            </div>
          </div>

          <form class="escribir" @submit.prevent="enviar">
            <input v-model="texto" maxlength="4000" placeholder="Escribí un mensaje…" />
            <button class="btn" type="submit" :disabled="enviando || !texto.trim()">Enviar</button>
          </form>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.dos { display: grid; grid-template-columns: 16rem 1fr; gap: var(--s-lg); align-items: start; }
@media (max-width: 48rem) { .dos { grid-template-columns: 1fr; } }

.lista { display: grid; gap: 2px; }
.hilo {
  display: grid; gap: 2px; text-align: left; width: 100%;
  padding: var(--s-sm) var(--s-md);
  border: 1px solid transparent; border-radius: var(--r-md);
  background: none; cursor: pointer; font: inherit;
}
.hilo:hover { background: var(--surface-2); }
.hilo.act { background: var(--accent-tint); border-color: var(--accent-line); }
.hilo .fila { display: flex; justify-content: space-between; align-items: center; gap: var(--s-sm); }
.hilo strong { font-size: 13px; }
.pendiente {
  min-width: 18px; padding: 0 5px; border-radius: var(--r-full);
  background: var(--warning); color: #fff;
  font-size: 10px; font-weight: 600; line-height: 18px; text-align: center;
}
.ultimo {
  font-size: 12px; color: var(--muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.charla { display: flex; flex-direction: column; min-height: 26rem; padding: 0; }
.elegir { margin: auto; color: var(--muted); font-size: 13px; }
.cab { padding: var(--s-md) var(--s-lg); border-bottom: 1px solid var(--line); font-weight: 600; }

.mensajes {
  flex: 1; overflow-y: auto; max-height: 60vh;
  padding: var(--s-lg); display: grid; gap: var(--s-md); align-content: start;
}
.msj { display: grid; gap: 2px; justify-items: start; max-width: 80%; }
/* Los míos a la derecha: es la convención de toda mensajería y romperla obliga
   a leer el nombre en cada globo para saber quién habló. */
.msj.mio { justify-self: end; justify-items: end; }
.quien { font-size: 11px; color: var(--muted); }
.texto {
  margin: 0; padding: var(--s-sm) var(--s-md);
  background: var(--surface-2); border-radius: var(--r-md);
  font-size: 13px; line-height: 1.45; white-space: pre-wrap;
}
.msj.mio .texto { background: var(--accent-tint); color: var(--accent-ink); }
.ref { font-size: 12px; color: var(--accent-ink); }
.cuando { font-size: 11px; color: var(--muted-2); }

.escribir {
  display: flex; gap: var(--s-sm);
  padding: var(--s-md) var(--s-lg); border-top: 1px solid var(--line);
}
.escribir input { flex: 1; }

.a-quien { min-width: 14rem; }
</style>
