<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { useAuth } from '../stores/auth';
import { filtrosRecordados } from '../dominio/filtros';

/**
 * La bandeja omnicanal.
 *
 * ── El orden NO es por más reciente ──
 *
 * Es por hace cuánto que alguien espera. La pregunta que se le hace a una
 * bandeja a la mañana es **a quién le estoy quedando mal**, y ordenar por
 * reciente la contesta al revés: pone arriba lo que acaba de entrar y entierra
 * al que espera desde ayer. El orden lo resuelve el back; acá se muestra el
 * tiempo de espera para que se vea POR QUÉ está arriba.
 *
 * ── El cuadro de respuesta dice la verdad ──
 *
 * Cuando el canal todavía no puede enviar —falta el token, falta la
 * verificación de Meta— el mensaje queda guardado y en cola, y la pantalla lo
 * dice con esas palabras. Es la misma regla del botón «Publicar» de la etapa 6
 * y del cobro en `mi-plan`: un mensaje que el usuario cree enviado y no salió
 * es peor que no tener el cuadro.
 *
 * ── Dos columnas y no dos pantallas ──
 *
 * Atender es leer y contestar sin perder de vista la cola. Con el hilo en otra
 * ruta, cada respuesta cuesta dos navegaciones y se pierde el lugar en la lista.
 */

interface Conversacion {
  id: string; canal: string; cuenta: string; contacto: string; direccion: string;
  estado: string; noLeido: boolean;
  asignadoA: string | null; asignadoNombre: string | null;
  botActivo: boolean;
  ultimoMensaje: string | null; ultimoMensajeEl: string | null;
  esperandoDesde: string | null; puedeResponderLibre: boolean;
}

interface Mensaje {
  id: string; direccion: string; autorTipo: string; autorNombre: string | null;
  cuerpo: string | null; adjuntos: Array<{ tipo: string; url?: string; nombre?: string }>;
  estado: string; error: string | null; creadoEl: string;
}

const auth = useAuth();

const conversaciones = ref<Conversacion[]>([]);
const total = ref(0);
const cargando = ref(true);
const error = ref('');

const abierta = ref<Conversacion | null>(null);
const mensajes = ref<Mensaje[]>([]);
const cargandoHilo = ref(false);

const texto = ref('');
const enviando = ref(false);
const avisoEnvio = ref('');

/**
 * Respuestas rápidas.
 *
 * Se cargan por canal del hilo abierto: lo que se manda por WhatsApp no es lo
 * que se manda por mail. Insertan el texto en el cuadro —**no lo envían**— así
 * que quien contesta ve el resultado final antes de mandarlo.
 */
const respuestas = ref<Respuesta[]>([]);
const listaAbierta = ref(false);
const avisoPlantilla = ref('');

interface Respuesta { id: string; nombre: string; cuerpo: string; canal: string | null }

async function cargarRespuestas(canal: string) {
  try {
    respuestas.value = await api<Respuesta[]>(`/respuestas?canal=${canal}`);
  } catch {
    // Sin plantillas se contesta igual: no es motivo para romper la pantalla.
    respuestas.value = [];
  }
}

async function usarRespuesta(r: Respuesta) {
  if (!abierta.value) return;
  listaAbierta.value = false;
  try {
    const res = await api<{ texto: string; faltantes: string[] }>(
      `/respuestas/${r.id}/aplicar`,
      { method: 'POST', body: JSON.stringify({ conversacionId: abierta.value.id }) },
    );
    // Se agrega a lo que ya haya escrito, no lo pisa: alguien que empezó a
    // redactar y busca una plantilla no quiere perder lo que puso.
    texto.value = texto.value ? `${texto.value}\n${res.texto}` : res.texto;
    avisoPlantilla.value = res.faltantes.length
      ? `Faltan datos para: ${res.faltantes.join(', ')}. Completalos antes de enviar.`
      : '';
  } catch (e) {
    avisoPlantilla.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo aplicar.';
  }
}

const { valores: filtros } = filtrosRecordados('inbox', {
  estado: 'abierta', canal: '', soloMios: false, noLeidos: false, q: '',
});

const ETIQUETA_CANAL: Record<string, string> = {
  whatsapp: 'WhatsApp', telegram: 'Telegram', email: 'Correo',
  instagram: 'Instagram', facebook: 'Facebook', sms: 'SMS',
};

/** «hace 3 h», «hace 2 días». Es el dato que justifica el orden de la lista. */
function haceCuanto(iso: string | null): string {
  if (!iso) return '';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/** Cuánto hace que espera, para pintar de rojo lo que ya es demasiado. */
const urgencia = (c: Conversacion): 'ok' | 'warn' | 'err' => {
  if (!c.esperandoDesde) return 'ok';
  const h = (Date.now() - new Date(c.esperandoDesde).getTime()) / 3_600_000;
  return h > 24 ? 'err' : h > 4 ? 'warn' : 'ok';
};

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const p = new URLSearchParams({ porPagina: '50' });
    if (filtros.value.estado) p.set('estado', filtros.value.estado);
    if (filtros.value.canal) p.set('canal', filtros.value.canal);
    if (filtros.value.soloMios) p.set('soloMios', 'true');
    if (filtros.value.noLeidos) p.set('noLeidos', 'true');
    if (filtros.value.q) p.set('q', filtros.value.q);

    const r = await api<{ items: Conversacion[]; total: number }>(`/inbox?${p}`);
    conversaciones.value = r.items;
    total.value = r.total;

    // Si el hilo abierto salió del filtro, se cierra: mostrarlo abierto al lado
    // de una lista que no lo tiene es decir dos cosas distintas a la vez.
    if (abierta.value && !r.items.some((c) => c.id === abierta.value!.id)) {
      abierta.value = null;
      mensajes.value = [];
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la bandeja.';
  } finally { cargando.value = false; }
}

async function abrir(c: Conversacion) {
  abierta.value = c;
  cargandoHilo.value = true;
  avisoEnvio.value = '';
  try {
    const r = await api<{ conversacion: Conversacion; mensajes: Mensaje[] }>(`/inbox/${c.id}`);
    abierta.value = r.conversacion;
    mensajes.value = r.mensajes;
    void cargarRespuestas(r.conversacion.canal);
    // Abrirlo lo marcó leído en el back: se refleja acá sin recargar todo.
    const enLista = conversaciones.value.find((x) => x.id === c.id);
    if (enLista) enLista.noLeido = false;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo abrir la conversación.';
  } finally { cargandoHilo.value = false; }
}

async function responder() {
  if (!abierta.value || !texto.value.trim()) return;
  enviando.value = true; avisoEnvio.value = '';
  try {
    const r = await api<{ enviado: boolean; detalle: string }>(
      `/inbox/${abierta.value.id}/mensajes`,
      { method: 'POST', body: JSON.stringify({ texto: texto.value }) },
    );
    texto.value = '';
    await abrir(abierta.value);
    await cargar();

    // El aviso va DESPUÉS de refrescar, y el orden no es cosmético: `abrir()`
    // limpia `avisoEnvio`, así que puesto antes se borraba solo y el agente
    // nunca se enteraba de que su mensaje había quedado en cola. Lo encontró la
    // verificación en el navegador, no los tests: es exactamente la clase de
    // bug que un test de servicio no puede ver.
    //
    // Se dice lo que pasó. Nunca «enviado» a secas.
    avisoEnvio.value = r.enviado ? '' : `Quedó guardado y en cola: ${r.detalle}`;
  } catch (e) {
    avisoEnvio.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo enviar.';
  } finally { enviando.value = false; }
}

async function cambiar(ruta: string, cuerpo: unknown) {
  if (!abierta.value) return;
  try {
    await api(`/inbox/${abierta.value.id}/${ruta}`, {
      method: 'PATCH', body: JSON.stringify(cuerpo),
    });
    await abrir(abierta.value);
    await cargar();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo actualizar.';
  }
}

const bajada = computed(() => {
  if (cargando.value) return 'Cargando…';
  const esperando = conversaciones.value.filter((c) => c.esperandoDesde).length;
  if (!total.value) return 'Sin conversaciones';
  return esperando
    ? `${total.value} conversaciones · ${esperando} esperando respuesta`
    : `${total.value} conversaciones · nadie esperando`;
});

watch(filtros, () => void cargar(), { deep: true });
onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Bandeja" :bajada="bajada">
      <template #acciones>
        <RouterLink v-if="auth.rol === 'owner' || auth.rol === 'admin'"
          class="btn secondary sm" to="/canales">Canales</RouterLink>
      </template>
    </PageHeader>

    <div class="filtros">
      <input v-model="filtros.q" class="buscar" type="search" placeholder="Buscar por nombre…" />
      <select v-model="filtros.estado">
        <option value="abierta">Abiertas</option>
        <option value="resuelta">Resueltas</option>
        <option value="archivada">Archivadas</option>
        <option value="bloqueada">Bloqueadas</option>
      </select>
      <select v-model="filtros.canal">
        <option value="">Todos los canales</option>
        <option v-for="(et, k) in ETIQUETA_CANAL" :key="k" :value="k">{{ et }}</option>
      </select>
      <label class="check"><input v-model="filtros.noLeidos" type="checkbox" /> Sin leer</label>
      <label class="check"><input v-model="filtros.soloMios" type="checkbox" /> Míos</label>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <UiSkeleton v-else-if="cargando" :filas="4" :alto="64" />

    <UiEmpty
      v-else-if="!conversaciones.length"
      titulo="No hay conversaciones"
      detalle="Cuando alguien escriba por un canal conectado, aparece acá. Los canales se conectan desde «Canales»." />

    <div v-else class="tablero">
      <!-- La cola -->
      <ul class="lista">
        <li v-for="c in conversaciones" :key="c.id">
          <button
            type="button"
            class="fila"
            :class="{ activa: abierta?.id === c.id, sinleer: c.noLeido }"
            @click="abrir(c)"
          >
            <div class="linea1">
              <span class="quien">{{ c.contacto }}</span>
              <span class="canal">{{ ETIQUETA_CANAL[c.canal] ?? c.canal }}</span>
            </div>
            <p class="preview">{{ c.ultimoMensaje ?? 'Sin mensajes' }}</p>
            <div class="linea3">
              <!-- El tiempo de espera se muestra porque es lo que justifica el
                   orden: sin esto la lista parece desordenada. -->
              <StatusChip
                v-if="c.esperandoDesde"
                :texto="`Espera ${haceCuanto(c.esperandoDesde)}`"
                :tono="urgencia(c)" />
              <span v-if="c.asignadoNombre" class="asignado">{{ c.asignadoNombre }}</span>
              <span v-if="!c.botActivo" class="botoff">Bot apagado</span>
            </div>
          </button>
        </li>
      </ul>

      <!-- El hilo -->
      <section v-if="abierta" class="hilo card">
        <header class="cab">
          <div>
            <strong>{{ abierta.contacto }}</strong>
            <span class="dir mono">{{ ETIQUETA_CANAL[abierta.canal] ?? abierta.canal }}</span>
          </div>
          <button v-if="abierta.estado === 'abierta'" class="btn secondary sm" type="button"
            @click="cambiar('estado', { estado: 'resuelta' })">Resolver</button>
          <button v-else class="btn secondary sm" type="button"
            @click="cambiar('estado', { estado: 'abierta' })">Reabrir</button>
        </header>

        <UiSkeleton v-if="cargandoHilo" :filas="3" :alto="40" />

        <div v-else class="mensajes">
          <div v-for="m in mensajes" :key="m.id" class="msg" :class="m.direccion">
            <div class="burbuja" :class="{ delbot: m.autorTipo === 'bot' }">
              <span v-if="m.autorTipo === 'bot'" class="autor">Bot automático</span>
              <span v-else-if="m.autorNombre" class="autor">{{ m.autorNombre }}</span>
              <p class="cuerpo">{{ m.cuerpo }}</p>
              <ul v-if="m.adjuntos.length" class="adjuntos">
                <li v-for="(ad, i) in m.adjuntos" :key="i">
                  <a v-if="ad.url" :href="ad.url" target="_blank" rel="noopener">
                    {{ ad.nombre ?? ad.tipo }}
                  </a>
                  <span v-else>{{ ad.nombre ?? ad.tipo }} (adjunto)</span>
                </li>
              </ul>
              <span class="pie-msg">
                {{ hora(m.creadoEl) }}
                <!-- El estado real del envío. «Pendiente» no es un detalle
                     técnico: es la diferencia entre que el cliente lo haya
                     leído o no. -->
                <template v-if="m.direccion === 'saliente'">
                  · {{ m.estado === 'pendiente' ? 'en cola' : m.estado }}
                </template>
              </span>
              <p v-if="m.error" class="err-msg">{{ m.error }}</p>
            </div>
          </div>
        </div>

        <!-- Fuera de la ventana de 24 h de Meta no se puede escribir libre. Se
             avisa ANTES de que alguien redacte un mensaje que va a rebotar. -->
        <p v-if="!abierta.puedeResponderLibre" class="aviso-ventana">
          Pasaron más de 24 horas desde el último mensaje de esta persona. Por
          las reglas de WhatsApp sólo se le puede enviar una plantilla aprobada;
          lo que escribas acá va a quedar en cola.
        </p>

        <div class="barra-respuestas">
          <button
            class="btn secondary sm"
            type="button"
            :disabled="!respuestas.length"
            @click="listaAbierta = !listaAbierta"
          >
            Respuestas rápidas{{ respuestas.length ? ` (${respuestas.length})` : '' }}
          </button>
          <RouterLink
            v-if="!respuestas.length && (auth.rol === 'owner' || auth.rol === 'admin')"
            class="crear-plantilla" to="/bot">
            Crear la primera
          </RouterLink>

          <!-- La plantilla INSERTA, no envía. Quien contesta ve el texto final
               antes de mandarlo, que es donde se nota si no aplica a ese
               cliente. -->
          <ul v-if="listaAbierta" class="plantillas">
            <li v-for="r in respuestas" :key="r.id">
              <button type="button" @click="usarRespuesta(r)">
                <strong>{{ r.nombre }}</strong>
                <span>{{ r.cuerpo }}</span>
              </button>
            </li>
          </ul>
        </div>

        <p v-if="avisoPlantilla" class="aviso-plantilla">{{ avisoPlantilla }}</p>

        <form class="responder" @submit.prevent="responder">
          <textarea
            v-model="texto" rows="3" required maxlength="4000"
            placeholder="Escribí tu respuesta…"
            @keydown.ctrl.enter="responder" />
          <div class="row">
            <button class="btn" type="submit" :disabled="enviando || !texto.trim()">
              {{ enviando ? 'Enviando…' : 'Responder' }}
            </button>
            <span class="atajo">Ctrl + Enter</span>
          </div>
          <p v-if="avisoEnvio" class="nota-cola">{{ avisoEnvio }}</p>
        </form>
      </section>

      <section v-else class="hilo card vacio">
        <p class="nota">Elegí una conversación de la izquierda.</p>
      </section>

      <!-- Tercera columna: lo que se HACE con la conversación, separado de lo
           que se DICE. En el video de referencia esto está a la derecha y es lo
           que evita que la cabecera del chat se llene de botones. -->
      <aside v-if="abierta" class="panel card stack">
        <div>
          <span class="et">Contacto</span>
          <p class="valor">{{ abierta.contacto }}</p>
          <p class="valor mono chico">{{ abierta.direccion }}</p>
        </div>

        <div>
          <span class="et">Canal</span>
          <p class="valor">{{ ETIQUETA_CANAL[abierta.canal] ?? abierta.canal }} · {{ abierta.cuenta }}</p>
        </div>

        <div>
          <span class="et">A cargo</span>
          <select
            class="sel"
            :value="abierta.asignadoA ?? ''"
            @change="cambiar('asignado', {
              usuarioId: ($event.target as HTMLSelectElement).value || null,
            })"
          >
            <option value="">Sin asignar</option>
            <option v-if="auth.usuario" :value="auth.usuario.id">Yo ({{ auth.usuario.nombre }})</option>
            <option
              v-if="abierta.asignadoA && abierta.asignadoA !== auth.usuario?.id"
              :value="abierta.asignadoA">
              {{ abierta.asignadoNombre }}
            </option>
          </select>
        </div>

        <div>
          <span class="et">Bot automático</span>
          <label class="switch">
            <input
              type="checkbox"
              :checked="abierta.botActivo"
              @change="cambiar('bot', { valor: ($event.target as HTMLInputElement).checked })" />
            <span>{{ abierta.botActivo ? 'Contesta solo' : 'Apagado en este chat' }}</span>
          </label>
          <!-- Se explica porque las dos formas de silenciarlo son distintas y
               no se nota mirando el interruptor. -->
          <p class="nota chico">
            Apagado a mano no vuelve solo. Cuando contestás vos, se calla 15
            minutos y se reactiva.
          </p>
        </div>

        <div>
          <span class="et">Estado</span>
          <div class="botones-estado">
            <button class="btn secondary sm" type="button"
              @click="cambiar('estado', { estado: 'archivada' })">Archivar</button>
            <button class="btn secondary sm" type="button"
              @click="cambiar('leido', { valor: false })">Marcar sin leer</button>
            <button class="btn secondary sm" type="button"
              @click="cambiar('estado', { estado: 'bloqueada' })">Bloquear</button>
          </div>
        </div>

        <p v-if="!abierta.puedeResponderLibre" class="nota chico">
          Fuera de la ventana de 24 h: sólo entra una plantilla aprobada.
        </p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.filtros { display: flex; gap: var(--s-sm); flex-wrap: wrap; align-items: center; }
.filtros select, .buscar {
  font: inherit; padding: 6px var(--s-sm); border: 1px solid var(--line-strong);
  border-radius: var(--r-md); background: var(--surface); color: var(--ink);
}
.buscar { min-width: 200px; }
.check { display: inline-flex; align-items: center; gap: var(--s-2xs); font-size: 13px; }

/* Tres columnas: la cola, la conversación y lo que se HACE con ella.
   Separar el panel de acciones del hilo es lo que evita que la cabecera del
   chat se llene de botones y que contestar y administrar se pisen. */
.tablero {
  display: grid;
  grid-template-columns: minmax(240px, 300px) minmax(0, 1fr) 240px;
  gap: var(--s-md);
  align-items: start;
}
/* En pantallas medianas cae el panel primero: la conversación importa más. */
@media (max-width: 1180px) {
  .tablero { grid-template-columns: minmax(240px, 300px) minmax(0, 1fr); }
  .panel { display: none; }
}
@media (max-width: 900px) { .tablero { grid-template-columns: 1fr; } }

.lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 70vh; overflow-y: auto; }
.fila {
  width: 100%; text-align: left; font: inherit; cursor: pointer;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md);
  padding: var(--s-sm) var(--s-md); display: flex; flex-direction: column; gap: 3px;
}
.fila:hover { border-color: var(--line-strong); }
.fila.activa { border-color: var(--accent); }
.fila.sinleer .quien { font-weight: 600; }
.linea1 { display: flex; align-items: baseline; gap: var(--s-sm); }
.quien { margin-right: auto; }
.canal { font-size: 11px; color: var(--muted-2); text-transform: uppercase; letter-spacing: 0.04em; }
.preview { margin: 0; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.linea3 { display: flex; gap: var(--s-xs); align-items: center; flex-wrap: wrap; }
.asignado, .botoff { font-size: 11px; color: var(--muted-2); }
.botoff { color: var(--warning); }

.hilo { display: flex; flex-direction: column; gap: var(--s-md); min-height: 400px; }
.hilo.vacio { align-items: center; justify-content: center; }
.cab { display: flex; align-items: flex-start; gap: var(--s-md); }
.cab > div:first-child { display: flex; flex-direction: column; margin-right: auto; }
.dir { font-size: 12px; color: var(--muted); }
.acciones { display: flex; gap: var(--s-xs); flex-wrap: wrap; }

.mensajes { display: flex; flex-direction: column; gap: var(--s-sm); max-height: 46vh; overflow-y: auto; padding-right: var(--s-xs); }
.msg { display: flex; }
.msg.saliente { justify-content: flex-end; }
.burbuja {
  max-width: 78%; padding: var(--s-sm) var(--s-md); border-radius: var(--r-lg);
  background: var(--surface-2); display: flex; flex-direction: column; gap: 2px;
}
.msg.saliente .burbuja { background: var(--accent-tint, var(--surface-2)); }
.burbuja.delbot { border: 1px dashed var(--line-strong); }
.autor { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted-2); }
.cuerpo { margin: 0; white-space: pre-wrap; font-size: 14px; line-height: 1.5; }
.adjuntos { margin: var(--s-2xs) 0 0; padding-left: 1em; font-size: 12px; }
.pie-msg { font-size: 10px; color: var(--muted-2); }
.err-msg { margin: var(--s-2xs) 0 0; font-size: 11px; color: var(--warning); }

.aviso-ventana {
  margin: 0; font-size: 12px; line-height: 1.6; padding: var(--s-sm) var(--s-md);
  background: var(--warning-tint, var(--surface-2)); border-radius: var(--r-md);
}

.responder { display: flex; flex-direction: column; gap: var(--s-xs); }
.responder textarea {
  font: inherit; padding: var(--s-sm) var(--s-md); resize: vertical;
  border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink); width: 100%;
}
.atajo { font-size: 11px; color: var(--muted-2); }
.nota-cola { margin: 0; font-size: 12px; color: var(--muted); }
.nota { margin: 0; font-size: 13px; color: var(--muted); }

/* ── Respuestas rápidas ── */
.barra-respuestas { position: relative; display: flex; align-items: center; gap: var(--s-sm); }
.crear-plantilla { font-size: 12px; color: var(--muted); }
.plantillas {
  position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 20;
  list-style: none; margin: 0; padding: var(--s-2xs);
  width: min(420px, 90vw); max-height: 260px; overflow-y: auto;
  background: var(--surface); border: 1px solid var(--line-strong);
  border-radius: var(--r-md); box-shadow: var(--sombra-menu, 0 8px 24px rgb(0 0 0 / 12%));
}
.plantillas button {
  width: 100%; text-align: left; font: inherit; cursor: pointer;
  background: none; border: 0; padding: var(--s-xs) var(--s-sm);
  border-radius: var(--r-sm); display: flex; flex-direction: column; gap: 2px;
}
.plantillas button:hover { background: var(--surface-2); }
.plantillas strong { font-size: 13px; }
.plantillas span {
  font-size: 12px; color: var(--muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.aviso-plantilla {
  margin: 0; font-size: 12px; color: var(--warning);
  padding: var(--s-2xs) var(--s-sm); background: var(--warning-tint, var(--surface-2));
  border-radius: var(--r-sm);
}

/* ── Panel de acciones ── */
.panel { gap: var(--s-md); position: sticky; top: var(--s-md); }
.panel .et {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--muted-2); display: block;
}
.panel .valor { margin: 2px 0 0; font-size: 13px; word-break: break-word; }
.panel .chico { font-size: 11px; color: var(--muted); line-height: 1.5; }
.sel {
  font: inherit; font-size: 13px; width: 100%; margin-top: 4px;
  padding: 5px var(--s-sm); border: 1px solid var(--line-strong);
  border-radius: var(--r-md); background: var(--surface); color: var(--ink);
}
.switch { display: flex; align-items: center; gap: var(--s-xs); font-size: 13px; margin-top: 4px; }
.switch input { accent-color: var(--accent); }
.botones-estado { display: flex; flex-direction: column; gap: var(--s-2xs); margin-top: 4px; }
</style>
