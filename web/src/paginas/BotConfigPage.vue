<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';

/**
 * Configuración del bot y de las respuestas rápidas.
 *
 * ── Por qué la caja de «probar» está arriba de todo ──
 *
 * Porque un bot cuyo comportamiento sólo se descubre cuando le escribe un
 * cliente real es un bot que nadie se anima a tocar. Escribir una frase y ver
 * **qué haría y por qué** es lo que convierte una lista de palabras en algo
 * configurable. No manda nada: el motor es puro, así que probar es gratis.
 *
 * ── Las palabras se editan separadas por comas ──
 *
 * No con un componente de chips. Alguien que quiere agregar tres palabras las
 * escribe de corrido y sigue; con chips tiene que apretar Enter entre cada una
 * y descubrirlo primero. Debajo se muestran separadas para que se lean.
 */

interface Regla { palabras: string[]; equipo: string }
interface ConfigBot {
  palabrasDeSalida: string[];
  ruteo: Regla[];
  palabrasDeConfirmacion: string[];
  palabrasDeCancelacion: string[];
  bienvenida: string;
  sinCoincidencia: string;
  porDefecto: Omit<ConfigBot, 'porDefecto'>;
}
interface Cuenta { id: string; nombre: string; canal: string; proveedor: string }
interface Respuesta {
  id: string; nombre: string; cuerpo: string; canal: string | null;
  activa: boolean; usos: number; vistaPrevia: string; desconocidas: string[];
}
interface Variable { clave: string; etiqueta: string; ejemplo: string }

const cuentas = ref<Cuenta[]>([]);
const cuentaId = ref('');
const config = ref<ConfigBot | null>(null);
const variables = ref<Variable[]>([]);
const respuestas = ref<Respuesta[]>([]);

const cargando = ref(true);
const guardando = ref(false);
const error = ref('');
const aviso = ref('');

/** Las listas se editan como texto y se parsean al guardar. */
const texto = reactive({
  salida: '', confirmacion: '', cancelacion: '', bienvenida: '', sinCoincidencia: '',
});
const ruteo = ref<Array<{ palabras: string; equipo: string }>>([]);

const prueba = reactive({ frase: '', primerMensaje: false, resultado: '', accion: '' });

const nueva = reactive({ nombre: '', cuerpo: '', canal: '' });
const editando = ref<string | null>(null);

const lista = (s: string) =>
  s.split(',').map((x) => x.trim()).filter(Boolean);

const enTexto = (l: string[]) => l.join(', ');

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const [cs, vs] = await Promise.all([
      api<Cuenta[]>('/canales'),
      api<Variable[]>('/respuestas/variables'),
    ]);
    cuentas.value = cs;
    variables.value = vs;
    if (!cuentaId.value && cs.length) cuentaId.value = cs[0].id;
    await Promise.all([cargarConfig(), cargarRespuestas()]);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar.';
  } finally { cargando.value = false; }
}

async function cargarConfig() {
  if (!cuentaId.value) return;
  const c = await api<ConfigBot>(`/bot/${cuentaId.value}`);
  config.value = c;
  texto.salida = enTexto(c.palabrasDeSalida);
  texto.confirmacion = enTexto(c.palabrasDeConfirmacion);
  texto.cancelacion = enTexto(c.palabrasDeCancelacion);
  texto.bienvenida = c.bienvenida ?? '';
  texto.sinCoincidencia = c.sinCoincidencia ?? '';
  ruteo.value = c.ruteo.map((r) => ({ palabras: enTexto(r.palabras), equipo: r.equipo }));
}

async function cargarRespuestas() {
  respuestas.value = await api<Respuesta[]>('/respuestas/todas');
}

async function guardar() {
  guardando.value = true; error.value = ''; aviso.value = '';
  try {
    await api(`/bot/${cuentaId.value}`, {
      method: 'PATCH',
      body: JSON.stringify({
        palabrasDeSalida: lista(texto.salida),
        palabrasDeConfirmacion: lista(texto.confirmacion),
        palabrasDeCancelacion: lista(texto.cancelacion),
        bienvenida: texto.bienvenida,
        sinCoincidencia: texto.sinCoincidencia,
        ruteo: ruteo.value
          .filter((r) => r.equipo.trim() && lista(r.palabras).length)
          .map((r) => ({ palabras: lista(r.palabras), equipo: r.equipo.trim() })),
      }),
    });
    aviso.value = 'Guardado. Las conversaciones nuevas ya usan estas reglas.';
    await cargarConfig();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo guardar.';
  } finally { guardando.value = false; }
}

async function probar() {
  if (!prueba.frase.trim()) return;
  prueba.resultado = ''; prueba.accion = '';
  try {
    const r = await api<{ decision: { accion: string }; explicacion: string }>(
      `/bot/${cuentaId.value}/probar`,
      {
        method: 'POST',
        body: JSON.stringify({ mensaje: prueba.frase, esPrimerMensaje: prueba.primerMensaje }),
      },
    );
    prueba.accion = r.decision.accion;
    prueba.resultado = r.explicacion;
  } catch (e) {
    prueba.resultado = e instanceof ApiError ? e.paraMostrar : 'No se pudo probar.';
  }
}

const tonoPrueba = computed(() => {
  if (prueba.accion === 'escalar') return 'warn';
  if (prueba.accion === 'callar') return 'err';
  return 'ok';
});

function agregarRegla() {
  ruteo.value = [...ruteo.value, { palabras: '', equipo: '' }];
}
function quitarRegla(i: number) {
  ruteo.value = ruteo.value.filter((_, j) => j !== i);
}

function volverAFabrica() {
  if (!config.value) return;
  const d = config.value.porDefecto;
  texto.salida = enTexto(d.palabrasDeSalida);
  texto.confirmacion = enTexto(d.palabrasDeConfirmacion);
  texto.cancelacion = enTexto(d.palabrasDeCancelacion);
  texto.bienvenida = d.bienvenida ?? '';
  texto.sinCoincidencia = d.sinCoincidencia ?? '';
  ruteo.value = d.ruteo.map((r) => ({ palabras: enTexto(r.palabras), equipo: r.equipo }));
  aviso.value = 'Se cargaron los valores de fábrica. Todavía no se guardaron.';
}

// ── Respuestas rápidas ──

async function guardarRespuesta() {
  error.value = '';
  try {
    if (editando.value) {
      await api(`/respuestas/${editando.value}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre: nueva.nombre, cuerpo: nueva.cuerpo, canal: nueva.canal || null,
        }),
      });
    } else {
      await api('/respuestas', {
        method: 'POST',
        body: JSON.stringify({
          nombre: nueva.nombre, cuerpo: nueva.cuerpo, canal: nueva.canal || null,
        }),
      });
    }
    nueva.nombre = ''; nueva.cuerpo = ''; nueva.canal = ''; editando.value = null;
    await cargarRespuestas();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo guardar la respuesta.';
  }
}

function editarRespuesta(r: Respuesta) {
  editando.value = r.id;
  nueva.nombre = r.nombre;
  nueva.cuerpo = r.cuerpo;
  nueva.canal = r.canal ?? '';
}

async function borrarRespuesta(r: Respuesta) {
  if (!confirm(`Se borra «${r.nombre}». No se puede deshacer.`)) return;
  await api(`/respuestas/${r.id}`, { method: 'DELETE' });
  await cargarRespuestas();
}

watch(cuentaId, () => void cargarConfig());
onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Configuración del bot"
      bajada="Qué contesta solo, cuándo avisa que hace falta una persona, y las respuestas rápidas del equipo.">
      <template #acciones>
        <RouterLink class="btn secondary sm" to="/inbox">Ir a la bandeja</RouterLink>
      </template>
    </PageHeader>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <UiSkeleton v-if="cargando" :filas="3" :alto="90" />

    <UiEmpty
      v-else-if="!cuentas.length"
      titulo="No hay canales conectados"
      detalle="El bot se configura por canal. Conectá uno desde «Canales» y volvé." />

    <template v-else>
      <label class="campo cuenta">
        <span>Canal a configurar</span>
        <select v-model="cuentaId">
          <option v-for="c in cuentas" :key="c.id" :value="c.id">
            {{ c.nombre }} · {{ c.canal }}
          </option>
        </select>
        <small>
          Cada canal tiene sus reglas: al de ventas y al de administración no les
          escribe la misma gente ni por lo mismo.
        </small>
      </label>

      <!-- Probar va ARRIBA a propósito: es lo que hace entendible todo lo de
           abajo. Escribís una frase y ves qué haría, sin mandarle nada a nadie. -->
      <section class="card stack probar">
        <h2>Probá una frase</h2>
        <p class="nota">
          Escribí lo que podría mandar un cliente y mirá qué haría el bot. No se
          envía nada ni queda registrado en ningún lado.
        </p>
        <div class="fila-probar">
          <input
            v-model="prueba.frase"
            placeholder="quiero hablar con un asesor"
            @keydown.enter="probar" />
          <button class="btn" type="button" @click="probar">Probar</button>
        </div>
        <label class="check">
          <input v-model="prueba.primerMensaje" type="checkbox" />
          Es el primer mensaje de la conversación
        </label>
        <div v-if="prueba.resultado" class="resultado">
          <StatusChip :texto="prueba.accion" :tono="tonoPrueba" />
          <span>{{ prueba.resultado }}</span>
        </div>
      </section>

      <section class="card stack">
        <h2>Cuándo pasa a una persona</h2>
        <p class="nota">
          Si el cliente escribe alguna de estas palabras, el bot deja de
          contestar y avisa. <strong>Ganan sobre cualquier otra regla</strong>:
          pedir una persona no se negocia.
        </p>
        <input v-model="texto.salida" class="ancho" />
        <ul class="chips">
          <li v-for="p in lista(texto.salida)" :key="p">{{ p }}</li>
        </ul>
      </section>

      <section class="card stack">
        <h2>A qué equipo derivar</h2>
        <p class="nota">
          Por tema. La primera regla que coincide gana, así que poné arriba las
          más específicas.
        </p>
        <div v-for="(r, i) in ruteo" :key="i" class="regla">
          <input v-model="r.palabras" placeholder="alquilar, alquiler, arriendo" />
          <span class="flecha">→</span>
          <input v-model="r.equipo" class="equipo" placeholder="alquileres" />
          <button class="btn secondary sm" type="button" @click="quitarRegla(i)">Quitar</button>
        </div>
        <div>
          <button class="btn secondary sm" type="button" @click="agregarRegla">
            Agregar regla
          </button>
        </div>
      </section>

      <section class="card stack">
        <h2>Confirmaciones y cancelaciones</h2>
        <p class="nota">
          Cuando el cliente confirma o cancela algo, el bot avisa para que
          alguien lo registre. Las cancelaciones se evalúan primero: «no puedo,
          cancelo» tiene las dos, y si ganara la confirmación el aviso diría lo
          contrario de lo que pasó.
        </p>
        <label class="campo">
          <span>Confirma</span>
          <input v-model="texto.confirmacion" />
        </label>
        <label class="campo">
          <span>Cancela o reprograma</span>
          <input v-model="texto.cancelacion" />
        </label>
      </section>

      <section class="card stack">
        <h2>Qué dice el bot</h2>
        <label class="campo">
          <span>Saludo del primer mensaje</span>
          <textarea v-model="texto.bienvenida" rows="3" />
          <small>Vacío = no saluda.</small>
        </label>
        <label class="campo">
          <span>Cuando no entiende</span>
          <textarea v-model="texto.sinCoincidencia" rows="2" />
          <!-- Se dice explícitamente porque es la decisión de producto más
               importante del bot y no es evidente mirando el formulario. -->
          <small>
            Vacío = no contesta nada y <strong>avisa que hace falta una
            persona</strong>. Es lo recomendado: un bot que contesta «no te
            entendí» y se queda ahí es el que hace que la gente deje de escribir.
          </small>
        </label>
      </section>

      <div class="row acciones-guardar">
        <button class="btn" type="button" :disabled="guardando" @click="guardar">
          {{ guardando ? 'Guardando…' : 'Guardar cambios' }}
        </button>
        <button class="btn secondary" type="button" @click="volverAFabrica">
          Volver a los valores de fábrica
        </button>
        <span v-if="aviso" class="ok-aviso">{{ aviso }}</span>
      </div>

      <!-- ── Respuestas rápidas ── -->
      <section class="card stack">
        <h2>Respuestas rápidas</h2>
        <p class="nota">
          Las plantillas que el equipo manda desde la bandeja. Se insertan en el
          cuadro de respuesta —<strong>no se envían solas</strong>— así que quien
          contesta ve el texto final antes de mandarlo.
        </p>

        <p class="nota">
          Variables disponibles:
          <code v-for="v in variables" :key="v.clave" class="var">{{ '{' + v.clave + '}' }}</code>
        </p>

        <form class="stack alta" @submit.prevent="guardarRespuesta">
          <div class="fila-alta">
            <input v-model="nueva.nombre" required maxlength="60" placeholder="Nombre (ej. Saludo inicial)" />
            <select v-model="nueva.canal">
              <option value="">Todos los canales</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="telegram">Telegram</option>
              <option value="email">Correo</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
            </select>
          </div>
          <textarea
            v-model="nueva.cuerpo" rows="3" required maxlength="2000"
            placeholder="Hola {nombre}, soy {agente} de {inmobiliaria}. ¿En qué te puedo ayudar?" />
          <div class="row">
            <button class="btn" type="submit">
              {{ editando ? 'Guardar cambios' : 'Agregar respuesta' }}
            </button>
            <button v-if="editando" class="btn secondary" type="button"
              @click="editando = null; nueva.nombre = ''; nueva.cuerpo = ''">
              Cancelar
            </button>
          </div>
        </form>

        <div v-for="r in respuestas" :key="r.id" class="respuesta">
          <div class="datos">
            <div class="titulo">
              <strong>{{ r.nombre }}</strong>
              <span class="meta">{{ r.canal ?? 'todos los canales' }} · {{ r.usos }} usos</span>
            </div>
            <p class="preview">{{ r.vistaPrevia }}</p>
            <!-- Un typo en una variable sale en cien mensajes antes de que
                 alguien lo lea: se avisa acá. -->
            <p v-if="r.desconocidas.length" class="typo">
              Estas variables no existen y van a salir tal cual:
              {{ r.desconocidas.join(', ') }}
            </p>
          </div>
          <div class="acciones">
            <button class="btn secondary sm" type="button" @click="editarRespuesta(r)">Editar</button>
            <button class="btn secondary sm" type="button" @click="borrarRespuesta(r)">Borrar</button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
h2 { margin: 0; font-size: 15px; }
.nota { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.6; max-width: 74ch; }
.campo { display: flex; flex-direction: column; gap: var(--s-2xs); }
.campo small { font-size: 12px; color: var(--muted); line-height: 1.5; }
.cuenta { max-width: 420px; }

input, select, textarea {
  font: inherit; padding: 8px var(--s-md); border: 1px solid var(--line-strong);
  border-radius: var(--r-md); background: var(--surface); color: var(--ink);
}
textarea { resize: vertical; width: 100%; }
.ancho { width: 100%; }

.probar { border: 1px solid var(--accent); }
.fila-probar { display: flex; gap: var(--s-sm); }
.fila-probar input { flex: 1; }
.check { display: inline-flex; align-items: center; gap: var(--s-2xs); font-size: 13px; }
.resultado {
  display: flex; align-items: center; gap: var(--s-sm); flex-wrap: wrap;
  font-size: 13px; padding: var(--s-sm) var(--s-md);
  background: var(--surface-2); border-radius: var(--r-md);
}

.chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--s-2xs); }
.chips li {
  font-size: 12px; border: 1px solid var(--line); border-radius: 999px;
  padding: 2px var(--s-sm); color: var(--muted);
}

.regla { display: flex; gap: var(--s-sm); align-items: center; flex-wrap: wrap; }
.regla input:first-child { flex: 1; min-width: 200px; }
.flecha { color: var(--muted-2); }
.equipo { width: 160px; }

.acciones-guardar { align-items: center; flex-wrap: wrap; gap: var(--s-sm); }
.ok-aviso { font-size: 13px; color: var(--muted); }

.var {
  font-size: 12px; background: var(--surface-2); padding: 1px 6px;
  border-radius: var(--r-sm); margin-right: 4px;
}
.alta { padding: var(--s-md); background: var(--surface-2); border-radius: var(--r-md); }
.fila-alta { display: flex; gap: var(--s-sm); }
.fila-alta input { flex: 1; }

.respuesta { display: flex; gap: var(--s-md); align-items: flex-start; padding: var(--s-sm) 0; }
.respuesta + .respuesta { border-top: 1px solid var(--line); }
.datos { margin-right: auto; min-width: 0; }
.titulo { display: flex; align-items: baseline; gap: var(--s-sm); flex-wrap: wrap; }
.meta { font-size: 11px; color: var(--muted-2); }
.preview { margin: 2px 0 0; font-size: 13px; color: var(--muted); white-space: pre-wrap; }
.typo { margin: var(--s-2xs) 0 0; font-size: 12px; color: var(--warning); }
.acciones { display: flex; gap: var(--s-xs); }
</style>
