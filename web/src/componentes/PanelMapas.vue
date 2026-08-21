<script setup lang="ts">
import { plural } from '../dominio/formato';
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

/**
 * Probar la key desde la pantalla.
 *
 * Existe para cerrar el circuito sin salir del navegador. Configurar la key son
 * cuatro pasos en Google Cloud y cualquiera de los cuatro puede quedar a medias;
 * la única forma de saber cuál era abrir una terminal y pegarle al endpoint de
 * diagnóstico. Ahora es un botón.
 *
 * Muestra el `mensajeDeGoogle` TAL CUAL: es lo único que dice **cuál** API falta
 * habilitar o **qué** restricción rebotó. Traducirlo pierde el dato, y ese dato
 * es la diferencia entre resolverlo en un minuto o perder una tarde.
 */
const probando = ref(false);
const resultadoPrueba = ref('');

async function probar() {
  probando.value = true;
  resultadoPrueba.value = '';
  try {
    const d = await api<Diagnostico>('/propiedades/geocoding/diagnostico');
    diag.value = d;
    resultadoPrueba.value = d.funciona
      ? '✓ La key funciona. Google respondió OK.'
      : `Google respondió «${d.estado}». ${d.mensajeDeGoogle ?? d.detalle}`;
    // Si empezó a andar, se recuentan las pendientes: el botón de ubicar
    // depende de eso y quedaría escondido hasta la próxima recarga.
    if (d.funciona) await cargar();
  } catch (e) {
    resultadoPrueba.value = e instanceof ApiError
      ? e.paraMostrar
      : 'No se pudo consultar el diagnóstico.';
  } finally {
    probando.value = false;
  }
}
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
        `${plural(r.resueltas, 'propiedad ubicada', 'propiedades ubicadas')}`,
        pendientes.value ? `quedan ${pendientes.value} por resolver` : 'no queda ninguna',
      );
      emit('sincronizado');
    } else {
      ui.info('Ninguna se pudo ubicar', 'Revisá las direcciones de la lista de abajo.');
    }
  } catch (e) {
    ui.error(
      'No se pudo sincronizar',
      e instanceof ApiError ? e.paraMostrar : 'Error inesperado',
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
    <!--
      UNA línea. Antes eran tres párrafos siempre visibles: 214px de la pantalla
      más usada del sistema, gastados en cada carga para contarle a alguien cómo
      se activa la facturación de un proyecto de Google. Medido: `/propiedades`
      gastaba 62% del alto antes del primer dato; `/contratos`, sin cartel, 31%.

      Un aviso que no se puede sacar y que ocupa medio pliegue deja de ser un
      aviso: se convierte en decoración que la gente aprende a saltear. Lo que
      hay que HACER queda a la vista; el porqué, a un clic.
    -->
    <header>
      <h2>Mapas</h2>
      <StatusChip
        :texto="diag.funciona ? 'Google conectado' : diag.configurado ? 'Con problema' : 'Sin configurar'"
        :tono="diag.funciona ? 'ok' : diag.configurado ? 'err' : 'warn'"
      />

      <p class="resumen">
        <template v-if="pendientes > 0">
          <b>{{ pendientes }}</b>
          {{ plural(pendientes, 'propiedad', 'propiedades', false) }} sin ubicación.
        </template>
        <template v-else>{{ diag.detalle }}</template>
      </p>

      <button class="probar" type="button" :disabled="probando" @click="probar">
        {{ probando ? 'Probando…' : 'Probar la key' }}
      </button>
    </header>

    <p v-if="resultadoPrueba" class="prueba">{{ resultadoPrueba }}</p>

    <!-- El mensaje crudo de Google es lo único que dice CUÁL API falta
         habilitar o QUÉ restricción rebotó. Se muestra tal cual. -->
    <pre v-if="diag.mensajeDeGoogle" class="mono google">{{ diag.mensajeDeGoogle }}</pre>

    <!--
      Las instrucciones de Google Cloud van PLEGADAS. Es documentación, no
      interfaz: se llevaban 250px arriba del fold de Propiedades, en cada carga,
      contándole a un administrador cómo se activa la facturación de un proyecto
      de Google. Quien tiene que hacerlo lo hace una vez; el resto ve la lista.
    -->
    <details v-if="!diag.configurado" class="como">
      <summary>Cómo se configura</summary>
      <p>{{ diag.detalle }}</p>
      <p>
        <b>El mapa de la ficha no depende de esta key</b>: es un iframe de
        <code class="mono">maps?…&amp;output=embed</code>, que no la lleva. Lo que
        falta sin key es resolver una dirección a coordenadas sola; las que ya
        tienen latitud y longitud —cargadas a mano o importadas— muestran su
        mapa igual.
      </p>
      <p>
        Se crea en Google Cloud: habilitar <b>Geocoding API</b> (sólo esa),
        activar la facturación del proyecto, y ponerle a la key <b>dos</b>
        restricciones: <b>de aplicación → direcciones IP</b> con la IP pública de
        salida del servidor —no «sitios web / referente HTTP»: las consultas
        salen del backend, sin cabecera <code class="mono">Referer</code>, y una
        key restringida por referrer devuelve
        <code class="mono">REQUEST_DENIED</code>— y <b>de API → Geocoding API</b>.
      </p>
      <p>
        Después va en <code class="mono">GOOGLE_MAPS_API_KEY</code> del
        <code class="mono">.env</code> y se levanta la API con
        <code class="mono">docker compose up -d api</code>.
        <b>No alcanza con <code class="mono">docker compose restart api</code></b>:
        reinicia el contenedor con el entorno con el que se creó y el
        <code class="mono">.env</code> nuevo no entra.
      </p>
      <p>
        El paso a paso completo, con los topes de cuota, está en
        <code class="mono">.env.example</code> y en
        <code class="mono">docs/CONTINUAR.md</code>.
      </p>
    </details>

    <!-- El mapa de la ficha NO depende de esta key: es un iframe de
         `maps?…&output=embed`, que no la lleva. Lo que falta sin key es resolver
         una dirección a coordenadas. Decirlo acá evita que quien lee este panel
         crea que sin la key no hay mapas en ningún lado. -->
    <template v-if="pendientes > 0 && diag.funciona">
      <p class="pendientes">
        Se resuelven de a 50 por vez — cada consulta a Google se paga.
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
/* Neutro, no ámbar.
 *
 * «Sin configurar» no es un problema: es algo que todavía no se hizo, y que no
 * impide trabajar —el mapa de la ficha anda igual, lo que falta es resolver una
 * dirección a coordenadas sola—. Pintado de ámbar, este panel gritaba en la
 * pantalla más usada del sistema, en cada carga, para siempre. Un color de
 * alarma que no se puede apagar deja de significar alarma: se aprende a
 * saltearlo, y el día que algo SÍ esté mal, ya nadie lo mira.
 *
 * El color queda reservado para `.roto`: una key configurada que falla sí es un
 * problema, y ése tiene arreglo. */
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--s-md);
  align-items: flex-start;
  background: var(--surface-2);
  border-color: var(--line);
}
.panel.roto { background: var(--danger-tint); border-color: var(--danger-line); }

/* Una sola fila. `flex-wrap` para que en pantalla angosta baje el botón y no
   se corte el resumen, que es lo único que hay que leer. */
header {
  display: flex;
  align-items: center;
  gap: var(--s-sm) var(--s-md);
  flex-wrap: wrap;
  width: 100%;
}
.resumen { margin: 0; margin-right: auto; font-size: 13px; }

.probar {
  font: inherit; font-size: 12px; cursor: pointer;
  background: none; border: 1px solid var(--line-strong);
  border-radius: var(--r-md); padding: 3px var(--s-sm); color: var(--ink);
}
.probar:hover:not(:disabled) { border-color: var(--accent); }
.probar:disabled { cursor: progress; opacity: 0.7; }

.prueba {
  margin: 0; font-size: 12px; line-height: 1.5;
  padding: var(--s-xs) var(--s-sm);
  background: var(--surface); border-radius: var(--r-sm);
  max-width: 80ch; word-break: break-word;
}

.detalle, .como, .pendientes {
  margin: 0;
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.5;
  max-width: 76ch;
}
.como { color: var(--muted); }
.como > summary {
  cursor: pointer;
  color: var(--accent-ink);
  font-size: 13px;
  /* El marcador nativo cambia de forma entre navegadores y no se puede alinear
     con el resto. Se apaga y la flecha va en el pseudo-elemento. */
  list-style: none;
}
.como > summary::-webkit-details-marker { display: none; }
.como > summary::before { content: '▸ '; }
.como[open] > summary::before { content: '▾ '; }
.como > summary:focus-visible { outline: 0; box-shadow: var(--ring); border-radius: var(--r-sm); }
.como > p { margin: var(--s-sm) 0 0; }
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
.motivo { color: var(--muted); font-size: 12px; }
</style>
