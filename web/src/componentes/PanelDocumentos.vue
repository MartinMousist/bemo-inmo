<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useUi } from '../stores/ui';
import StatusChip from './StatusChip.vue';
import { fechaHora, plural } from '../dominio/formato';

/**
 * El editor entra perezoso: `starter-kit` arrastra ProseMirror y unos
 * veinticuatro subpaquetes de `@tiptap/*`. Con un import normal lo pagaría
 * también quien entra a la ficha de un contrato y nunca abre el pre-contrato.
 */
const EditorDocumento = defineAsyncComponent(
  () => import('./EditorDocumento.vue'),
);

/**
 * El pre-contrato de ESTE contrato: generarlo, editarlo, mandarlo y guardarlo.
 *
 * Antes acá se generaba el texto, se mostraba en un `<pre>` de sólo lectura y se
 * evaporaba: no se podía cambiar una coma, no había forma de mandarlo y el
 * sistema no guardaba nada. «¿Qué le mandamos a esta gente?» no tenía respuesta.
 *
 * Cuatro decisiones de esta pantalla:
 *
 * **El texto se edita antes de mandarlo.** Un pre-contrato tiene cláusulas que
 * se negocian; que el sistema imprima el modelo y no lo que se acordó obliga a
 * copiar todo a un procesador de texto, y ahí se pierde el rastro.
 *
 * **Los tres canales trabajan sobre el texto GUARDADO.** El documento se guarda
 * solo mientras se escribe, y hasta que ese guardado termina los tres botones
 * están deshabilitados diciendo por qué. Es la única forma de garantizar que lo
 * que sale es lo que se ve: un enlace armado con la versión anterior mandaría
 * un párrafo que la persona ya había corregido. Lo que se registra se llama «se
 * abrió», no «se envió» — el sistema abre el WhatsApp o el cliente de correo del
 * usuario, y apretar enviar sigue siendo de la persona.
 *
 * **El motivo se dice ANTES de apretar.** Un pre-contrato no entra en un
 * `mailto:` y una plantilla de tres carillas tampoco entra en WhatsApp. Cuando
 * no entra va como archivo con una carátula corta, y la pantalla explica por
 * qué, con el número de caracteres y el límite. Nada de truncar en silencio: un
 * contrato cortado al medio parece completo.
 *
 * **Los enlaces son `<a href>` de verdad**, con la URL que arma el back. Ni un
 * `window.open` después de un `await` —que el navegador bloquea— ni la regla del
 * límite copiada en el front: vive en `envio.motor.ts`, que es donde se testea.
 */

interface Plantilla { id: string; tipo: string; nombre: string }
interface Destinatario {
  nombre: string; rol: 'locatario' | 'locador' | 'garante';
  telefono: string | null; email: string | null;
}
interface Envio {
  id: string; canal: string; destino: string | null; modo: string | null;
  caracteres: number | null; abiertoEl: string; abiertoPor: string | null;
}
interface Documento {
  id: string;
  plantillaNombre: string;
  titulo: string | null;
  textoGenerado: string;
  textoFinal: string;
  /** Congelado al generar: decide si esto se edita con formato o como texto. */
  formato: 'texto' | 'html';
  /**
   * El documento dicho en texto plano, tal como lo calcula el backend.
   *
   * Es lo que baja como `.txt`, lo que copia «Copiar» y lo que se mide para
   * decidir si el envío va completo o adjunto. **Viene de la API a propósito**:
   * una segunda implementación de `htmlATexto()` acá serían dos textos
   * distintos el día que se toque una. Es la misma regla que ya estaba escrita
   * en este archivo sobre no copiar el límite del envío al front.
   */
  textoPlano: string;
  editado: boolean;
  faltantes: string[];
  generadoPor: string | null;
  bloqueado: boolean;
  createdAt: string;
  envios: Envio[];
  contrato: { etiqueta: string; direccion: string; inmobiliaria: string };
}
interface Preparado {
  canal: string; modo: 'completo' | 'adjunto'; url: string | null;
  destino: string | null; destinoLegible: string | null;
  caracteres: number; limite: number; medido: string;
  motivo: string | null; advertencia: string | null;
}

const props = withDefaults(
  defineProps<{
    contratoId: string;
    etiqueta: string;
    /** `false` cuando lo envuelve un `BloqueColapsable`: el card y el `<h2>`
     *  los pone él. Default `true` para no tocar lo que ya existía. */
    marco?: boolean;
    /**
     * Aterrizar con el último documento ya abierto en el textarea.
     *
     * Lo prende `?nuevo=1`: si el pre-contrato se armó solo al crear el
     * contrato, tenerlo que buscar en el historial y apretar «Abrir» convierte
     * un paso ahorrado en dos pasos nuevos.
     */
    abrirUltimo?: boolean;
  }>(),
  { marco: true, abrirUltimo: false },
);

/** Generar, editar o registrar un envío mueve los números de la cabecera. */
const emit = defineEmits<{ cambio: [] }>();

const ui = useUi();
const plantillas = ref<Plantilla[]>([]);
const destinatarios = ref<Destinatario[]>([]);
const historial = ref<Documento[]>([]);
const elegida = ref('');
const doc = ref<Documento | null>(null);
const texto = ref('');
const generando = ref(false);
const guardando = ref(false);
const error = ref('');

/** A quién se le manda. Editable: el teléfono de la ficha puede estar mal. */
/** Lo que dejó el último pegado desde Word. Se muestra hasta abrir otro documento. */
const avisosPegado = ref<string[]>([]);
const destinoWa = ref('');
const destinoMail = ref('');
const waPrep = ref<Preparado | null>(null);
const mailPrep = ref<Preparado | null>(null);

const ETIQUETA_CANAL: Record<string, string> = {
  whatsapp: 'WhatsApp', email: 'Email', impresion: 'Impresión',
  descarga: 'Descarga', copia: 'Copiado',
};
const ETIQUETA_ROL: Record<string, string> = {
  locatario: 'inquilino', locador: 'propietario', garante: 'garante',
};

/**
 * Lo que dicen los tres canales mientras el texto todavía no está guardado.
 *
 * No es una traba burocrática: los enlaces los arma el back sobre el texto que
 * está en la base, así que abrir uno con cambios sin guardar mandaría la versión
 * anterior. Dura lo que tarda el guardado automático.
 */
const ESPERANDO = 'Guardando los cambios… se habilita en cuanto termine.';

/**
 * Sólo las que tienen sentido para un contrato.
 *
 * El recibo se genera desde un cobro y la liquidación desde una liquidación:
 * ofrecerlas acá sería ofrecer algo que va a fallar, y un control que no va a
 * funcionar es peor que la ausencia del control.
 */
const utiles = computed(() =>
  plantillas.value.filter((p) =>
    ['pre_contrato_alquiler', 'pre_contrato_venta', 'reserva',
     'aviso_aumento', 'aviso_vencimiento', 'otro'].includes(p.tipo),
  ),
);

/** Lo que se editó desde que se generó. Se muestra, no se esconde. */
const cambiado = computed(() => !!doc.value && texto.value !== doc.value.textoGenerado);
const sinGuardar = computed(() => !!doc.value && texto.value !== doc.value.textoFinal);

onMounted(async () => {
  try {
    const [ps, ds, hs] = await Promise.all([
      api<Plantilla[]>('/plantillas'),
      api<Destinatario[]>(`/contratos/${props.contratoId}/documentos/destinatarios`),
      api<Documento[]>(`/contratos/${props.contratoId}/documentos`),
    ]);
    plantillas.value = ps;
    destinatarios.value = ds;
    historial.value = hs;
    // El historial viene ordenado `created_at DESC`: el [0] es el último que se
    // generó, que con `?nuevo=1` es justo el pre-contrato recién armado.
    if (props.abrirUltimo && hs.length) abrir(hs[0]);
    // La de pre-contrato de alquiler viene elegida: es la que se usa el 90% de
    // las veces desde acá.
    elegida.value = utiles.value.find((p) => p.tipo === 'pre_contrato_alquiler')?.id
      ?? utiles.value[0]?.id
      ?? '';
    // El inquilino primero: es a quien se le manda el pre-contrato.
    const conTel = ds.find((d) => d.telefono);
    const conMail = ds.find((d) => d.email);
    destinoWa.value = conTel?.telefono ?? '';
    destinoMail.value = conMail?.email ?? '';
  } catch {
    plantillas.value = [];
  }
});

/**
 * Genera y GUARDA en el mismo paso.
 *
 * Guardar recién al mandar dejaría sin registro los que alguien generó, miró y
 * descartó — y ésos también dicen algo. Además es lo que da el id con el que
 * después se edita, se imprime y se manda.
 */
async function generar() {
  if (!elegida.value) return;
  generando.value = true;
  error.value = '';
  try {
    const d = await api<Documento>('/documentos', {
      method: 'POST',
      body: JSON.stringify({ contratoId: props.contratoId, plantillaId: elegida.value }),
    });
    abrir(d);
    historial.value = [d, ...historial.value];
    emit('cambio');
  } catch (e) {
    doc.value = null;
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo generar el documento.';
  } finally {
    generando.value = false;
  }
}

function abrir(d: Documento) {
  doc.value = d;
  texto.value = d.textoFinal;
  avisosPegado.value = [];
  waPrep.value = null;
  mailPrep.value = null;
  void preparar();
}

async function guardar(): Promise<boolean> {
  if (!doc.value || !sinGuardar.value) return true;
  guardando.value = true;
  try {
    const d = await api<Documento>(`/documentos/${doc.value.id}`, {
      method: 'PUT',
      body: JSON.stringify({ textoFinal: texto.value }),
    });
    doc.value = d;
    reemplazarEnHistorial(d);
    emit('cambio');
    return true;
  } catch (e) {
    ui.error('No se pudo guardar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
    return false;
  } finally {
    guardando.value = false;
  }
}

function reemplazarEnHistorial(d: Documento) {
  const i = historial.value.findIndex((x) => x.id === d.id);
  if (i >= 0) historial.value[i] = d;
  else historial.value = [d, ...historial.value];
}

/**
 * Pide los dos enlaces al back sin registrar nada.
 *
 * El back es el que sabe si el texto entra o no: la regla del límite es de
 * negocio y vive en el motor puro. Copiar acá un `if (texto.length > 4000)`
 * dejaría dos versiones del mismo número.
 */
async function preparar() {
  if (!doc.value) return;
  const id = doc.value.id;
  const pedir = async (canal: string, destino: string) => {
    if (!destino.trim()) return null;
    try {
      return await api<Preparado>(
        `/documentos/${id}/preparar?canal=${canal}&destino=${encodeURIComponent(destino.trim())}`,
      );
    } catch { return null; }
  };
  const [w, m] = await Promise.all([
    pedir('whatsapp', destinoWa.value),
    pedir('email', destinoMail.value),
  ]);
  waPrep.value = w;
  mailPrep.value = m;
}

// El enlace se rearma cuando cambia el destinatario o el texto: el largo decide
// el modo, así que agregar dos párrafos puede pasarlo de «completo» a «adjunto»
// y eso hay que verlo mientras se escribe, no al apretar.
let debounce: ReturnType<typeof setTimeout> | undefined;
watch([destinoWa, destinoMail, texto], () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => void prepararConGuardado(), 500);
});

async function prepararConGuardado() {
  // El back prepara sobre el texto GUARDADO. Si hay cambios sin guardar, se
  // guardan primero: si no, el enlace se armaría con la versión vieja.
  if (sinGuardar.value && doc.value && !doc.value.bloqueado) await guardar();
  await preparar();
}

/**
 * Guarda y registra el envío. Después el navegador abre el enlace.
 *
 * Devuelve `false` si algo falló, para poder frenar la navegación del `<a>`.
 */
async function registrar(canal: string, destino?: string): Promise<boolean> {
  if (!doc.value) return false;
  if (!(await guardar())) return false;
  try {
    const r = await api<{ documento: Documento }>(`/documentos/${doc.value.id}/envios`, {
      method: 'POST',
      body: JSON.stringify({ canal, ...(destino ? { destino } : {}) }),
    });
    doc.value = r.documento;
    reemplazarEnHistorial(r.documento);
    // Registrar un envío es lo que pasa un documento de «sin mandar» a mandado:
    // sin este aviso la cabecera cerrada sigue diciendo «1 sin mandar».
    emit('cambio');
    return true;
  } catch (e) {
    ui.error('No se registró el envío', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
    return false;
  }
}

/**
 * El clic sobre el enlace del canal.
 *
 * El `<a href>` es real y el navegador navega solo: es la única forma de que
 * `wa.me` y `mailto:` abran sin que un bloqueador de ventanas emergentes se
 * meta en el medio, y es el mismo patrón que ya usa el WhatsApp de garantes. El
 * registro sale con el mismo clic; la página no se descarga —el chat abre en
 * otra pestaña y el correo en otra aplicación— así que el POST llega. Si no
 * llegara, la pantalla lo dice en vez de dar por hecho que quedó anotado.
 */
async function abrirCanal(ev: MouseEvent, prep: Preparado | null, destino: string) {
  if (!prep?.url) { ev.preventDefault(); return; }
  // En modo adjunto el texto NO viaja en el enlace: baja como archivo y el
  // mensaje lleva sólo la carátula. Sin esto, del otro lado llega un «te paso
  // el pre-contrato» sin ningún pre-contrato.
  if (prep.modo === 'adjunto') descargarTxt(await textoPlano());
  await registrar(prep.canal, destino);
  await preparar();
}

/**
 * El documento en texto plano, pedido al backend.
 *
 * NO se calcula acá. Con el editor con formato, `texto.value` es HTML: bajarlo
 * como `.txt` mandaría un archivo con las etiquetas a la vista, y copiarlo
 * pegaría `<p>` en el WhatsApp de alguien. La proyección vive en
 * `plantillas.html.ts`, que es donde se prueba.
 */
async function textoPlano(): Promise<string> {
  if (!doc.value) return '';
  if (doc.value.formato !== 'html') return texto.value;
  try {
    const r = await api<{ texto: string }>(`/documentos/${doc.value.id}/texto`);
    return r.texto;
  } catch {
    // Se devuelve lo último que el back ya había calculado en vez de improvisar
    // una conversión distinta acá.
    return doc.value.textoPlano;
  }
}

/** Descarga como `.txt`: el navegador no necesita ninguna librería para esto. */
function descargarTxt(contenido: string) {
  const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${props.etiqueta}-${doc.value?.plantillaNombre ?? 'documento'}`
    .replace(/[^\w\-.]+/g, '-')
    .toLowerCase() + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Guarda antes de proyectar a texto plano.
 *
 * `GET /documentos/:id/texto` proyecta lo que está EN LA BASE. «Copiar» y
 * «Descargar» no están trabados por `sinGuardar` como sí lo están los tres
 * canales, así que sin esto, quien edita un párrafo y aprieta «Copiar» antes de
 * que corra el guardado automático de 500 ms se lleva la versión ANTERIOR del
 * documento, sin que nada se lo diga. Antes del editor con formato no pasaba:
 * los dos botones copiaban `texto.value`, que es lo que está en pantalla.
 *
 * Devuelve `false` si el guardado falló —`guardar()` ya avisó por qué— y
 * entonces no se copia ni se baja nada: mejor sin archivo que con el viejo.
 */
async function guardarAntesDeProyectar(): Promise<boolean> {
  if (!doc.value || doc.value.bloqueado) return true;
  return guardar();
}

async function descargar() {
  if (!doc.value) return;
  if (!(await guardarAntesDeProyectar())) return;
  descargarTxt(await textoPlano());
  await registrar('descarga');
}

async function copiar() {
  if (!(await guardarAntesDeProyectar())) return;
  try {
    await navigator.clipboard.writeText(await textoPlano());
    ui.ok('Copiado', 'Se copió sin el formato: es texto para pegar donde sea.');
    await registrar('copia');
  } catch {
    ui.error('No se pudo copiar', 'Seleccioná el texto y copialo a mano.');
  }
}

async function verDelHistorial(d: Documento) {
  try {
    abrir(await api<Documento>(`/documentos/${d.id}`));
  } catch (e) {
    ui.error('No se pudo abrir', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  }
}
</script>

<template>
  <section class="stack" :class="{ card: marco }">
    <header v-if="marco" class="cab">
      <h2>Pre-contrato y avisos</h2>
    </header>

    <p v-if="!plantillas.length" class="ayuda">
      No hay plantillas cargadas todavía.
      <RouterLink to="/plantillas">Traer las base</RouterLink> y volver acá.
    </p>

    <template v-else>
      <div class="barra">
        <label class="campo suave crece">
          <span>Documento</span>
          <select v-model="elegida">
            <option v-for="p in utiles" :key="p.id" :value="p.id">{{ p.nombre }}</option>
          </select>
        </label>
        <button class="btn" type="button" :disabled="generando || !elegida" @click="generar">
          {{ generando ? 'Generando…' : 'Generar' }}
        </button>
      </div>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <template v-if="doc">
        <p v-if="doc.faltantes.length" class="alert aviso">
          {{ plural(doc.faltantes.length, 'variable sin dato', 'variables sin dato') }}:
          <code v-for="f in doc.faltantes" :key="f" class="mono">{{ f }}</code>.
          Puede ser normal —hay cláusulas que se completan a mano— pero conviene
          mirarlas antes de imprimir.
        </p>

        <!-- El documento congelado. Es la misma regla que un ajuste confirmado. -->
        <p v-if="doc.bloqueado" class="alert aviso">
          Este documento ya salió: el texto que se mandó es el que queda.
          Para cambiarlo, generá uno nuevo con «Generar».
        </p>

        <div class="campo suave">
          <span class="cab-texto">
            Texto del documento
            <StatusChip v-if="cambiado" texto="Editado" tono="acento" />
            <span v-if="sinGuardar && !doc.bloqueado" class="pend">· sin guardar</span>
          </span>

          <p v-for="a in avisosPegado" :key="a" class="alert aviso chico">{{ a }}</p>

          <!-- Sin menú de variables: en un documento YA GENERADO no quedan
               `{{ }}`, el motor los resolvió. Ofrecer el menú acá insertaría un
               token que nadie va a volver a renderizar y saldría impreso. -->
          <EditorDocumento
            v-if="doc.formato === 'html'"
            v-model="texto"
            :solo-lectura="doc.bloqueado"
            etiqueta="Texto del documento"
            :alto="380"
            @avisos="avisosPegado = $event"
          />
          <!-- Los documentos viejos salieron en texto plano y se siguen
               editando así: convertirlos cambiaría un papel que ya se entregó. -->
          <textarea
            v-else
            v-model="texto" rows="18" spellcheck="false" class="mono texto"
            :readonly="doc.bloqueado"
          />
        </div>

        <p v-if="cambiado && !doc.bloqueado" class="ayuda">
          Se está mandando el texto editado, no el de la plantilla. La diferencia
          queda guardada: el sistema conserva las dos versiones.
        </p>

        <!-- ── Los tres canales ──────────────────────────────────────────── -->
        <div class="canales">
          <div class="canal">
            <label class="campo suave">
              <span>WhatsApp de</span>
              <input v-model="destinoWa" placeholder="261 615-2233" />
            </label>
            <p v-if="destinatarios.length" class="ayuda contactos">
              <button
                v-for="d in destinatarios.filter((x) => x.telefono)" :key="d.nombre"
                class="btn enlace sm" type="button" @click="destinoWa = d.telefono!"
              >{{ d.nombre }} ({{ ETIQUETA_ROL[d.rol] }})</button>
            </p>
            <p v-if="waPrep?.destinoLegible" class="ayuda">
              Va a abrir el chat de <strong>{{ waPrep.destinoLegible }}</strong>.
            </p>
            <p v-if="waPrep?.motivo" class="alert aviso chico">{{ waPrep.motivo }}</p>
            <p v-else-if="waPrep" class="ayuda">
              {{ waPrep.caracteres.toLocaleString('es-AR') }} de
              {{ waPrep.limite.toLocaleString('es-AR') }} {{ waPrep.medido }}: entra entero.
            </p>
            <p v-if="waPrep?.advertencia" class="ayuda ojo">{{ waPrep.advertencia }}</p>
            <a
              v-if="waPrep?.url && !sinGuardar" class="btn primary" :href="waPrep.url"
              target="_blank" rel="noopener"
              @click="abrirCanal($event, waPrep, destinoWa)"
            >Abrir WhatsApp</a>
            <button v-else class="btn primary" type="button" disabled>Abrir WhatsApp</button>
            <p v-if="sinGuardar" class="ayuda">{{ ESPERANDO }}</p>
            <p v-else-if="!waPrep?.url" class="ayuda">
              {{ waPrep?.motivo ? 'Corregí el número para poder abrir el chat.'
                 : 'Cargá un teléfono para poder abrir el chat.' }}
            </p>
          </div>

          <div class="canal">
            <label class="campo suave">
              <span>Email a</span>
              <input v-model="destinoMail" placeholder="nombre@correo.com" />
            </label>
            <p v-if="destinatarios.length" class="ayuda contactos">
              <button
                v-for="d in destinatarios.filter((x) => x.email)" :key="d.nombre"
                class="btn enlace sm" type="button" @click="destinoMail = d.email!"
              >{{ d.nombre }} ({{ ETIQUETA_ROL[d.rol] }})</button>
            </p>
            <p v-if="mailPrep?.motivo" class="alert aviso chico">{{ mailPrep.motivo }}</p>
            <p v-else-if="mailPrep" class="ayuda">
              {{ mailPrep.caracteres.toLocaleString('es-AR') }} de
              {{ mailPrep.limite.toLocaleString('es-AR') }} {{ mailPrep.medido }}: entra entero.
            </p>
            <a
              v-if="mailPrep?.url && !sinGuardar" class="btn primary" :href="mailPrep.url"
              @click="abrirCanal($event, mailPrep, destinoMail)"
            >Abrir el correo</a>
            <button v-else class="btn primary" type="button" disabled>Abrir el correo</button>
            <p v-if="sinGuardar" class="ayuda">{{ ESPERANDO }}</p>
            <p v-else-if="!mailPrep?.url" class="ayuda">
              {{ mailPrep?.motivo ? 'Corregí la dirección para poder abrir el correo.'
                 : 'Cargá un email para poder abrir el correo.' }}
            </p>
          </div>

          <div class="canal">
            <p class="ayuda">
              Se abre en una hoja aparte, con el membrete de la inmobiliaria y sin
              el resto de la ficha. Desde ahí el navegador ofrece «Guardar como PDF».
              La impresión también queda anotada en el historial.
            </p>
            <!-- Ruta propia y no un diálogo sobre esta pantalla: el `@media
                 print` global esconde botones y navegación pero imprime TODO el
                 resto de la página, así que desde acá saldrían atrás del
                 pre-contrato los aumentos, las cuotas y los garantes. -->
            <a
              v-if="!sinGuardar" class="btn primary"
              :href="`/documentos/${doc.id}/imprimir`" target="_blank" rel="noopener"
            >Imprimir</a>
            <button v-else class="btn primary" type="button" disabled>Imprimir</button>
            <p v-if="sinGuardar" class="ayuda">{{ ESPERANDO }}</p>
          </div>
        </div>

        <div class="pie">
          <!-- Lo que el sistema hace termina acá: el documento sale, la firma
               pasa afuera. Ver spec §1. -->
          <span class="nota">
            El documento sale de acá; la firma se hace afuera. El sistema
            <strong>no manda</strong> el mensaje: abre tu WhatsApp o tu correo con el
            texto cargado y quedan registrados quién lo abrió y cuándo.
          </span>
          <button
            class="btn secondary sm" type="button"
            :disabled="guardando || !sinGuardar || doc.bloqueado" @click="guardar"
          >{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
          <button class="btn secondary sm" type="button" @click="copiar">Copiar</button>
          <button class="btn secondary sm" type="button" @click="descargar">Descargar</button>
        </div>
      </template>

      <!-- ── Historial ─────────────────────────────────────────────────────── -->
      <section v-if="historial.length" class="historial">
        <h3>Documentos de este contrato</h3>
        <ul class="lista">
          <li v-for="h in historial" :key="h.id">
            <div class="que">
              <span class="titulo">
                {{ h.titulo ?? h.plantillaNombre }}
                <StatusChip v-if="h.editado" texto="Editado" tono="acento" />
                <StatusChip v-if="!h.envios.length" texto="Sin mandar" tono="warn" />
              </span>
              <span class="meta">
                {{ h.plantillaNombre }} · generado por {{ h.generadoPor ?? 'alguien que ya no está' }}
                el {{ fechaHora(h.createdAt) }}
              </span>
              <span v-if="h.envios.length" class="meta">
                <template v-for="(e, i) in h.envios" :key="e.id">
                  <template v-if="i">· </template>Se abrió {{ ETIQUETA_CANAL[e.canal] ?? e.canal }}
                  <template v-if="e.destino">a {{ e.destino }}</template>
                  el {{ fechaHora(e.abiertoEl) }}<template v-if="e.abiertoPor"> ({{ e.abiertoPor }})</template>
                  <template v-if="e.modo === 'adjunto'"> · fue como archivo</template>
                </template>
              </span>
            </div>
            <div class="acciones">
              <button class="btn enlace sm" type="button" @click="verDelHistorial(h)">
                {{ doc?.id === h.id ? 'Abierto' : 'Abrir' }}
              </button>
              <a class="btn enlace sm" :href="`/documentos/${h.id}/imprimir`" target="_blank" rel="noopener">
                Imprimir
              </a>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.cab { display: flex; align-items: center; justify-content: space-between; gap: var(--s-md); }
.cab h2 { margin: 0; }
.barra { display: flex; align-items: flex-end; gap: var(--s-md); flex-wrap: wrap; }
.barra .crece { flex: 1 1 220px; }
.ayuda { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.6; }
.ayuda.ojo { color: var(--warning-ink); }
.contactos { display: flex; flex-wrap: wrap; gap: var(--s-xs) var(--s-sm); }

.cab-texto { display: flex; align-items: center; gap: var(--s-sm); }
.pend { font-size: 11px; color: var(--warning-ink); }
.texto { line-height: 1.55; font-size: 12.5px; min-height: 320px; }

.canales {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--s-lg);
  align-items: start;
}
.canal {
  display: flex; flex-direction: column; gap: var(--s-sm);
  padding: var(--s-md);
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}
.canal .btn { align-self: flex-start; }
.alert.chico { font-size: 11.5px; line-height: 1.55; }

.pie { display: flex; align-items: center; justify-content: flex-end; gap: var(--s-sm); flex-wrap: wrap; }
.nota { margin-right: auto; font-size: 12px; color: var(--muted); max-width: 46ch; line-height: 1.6; }

.historial { display: flex; flex-direction: column; gap: var(--s-sm); }
.historial h3 { margin: 0; }
.lista { list-style: none; margin: 0; padding: 0; }
.lista li {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: var(--s-lg); padding: var(--s-md) 0;
  border-bottom: 1px solid var(--line);
}
.lista li:last-child { border-bottom: none; }
.que { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.titulo { display: flex; align-items: center; gap: var(--s-sm); font-size: 14px; color: var(--ink); }
.meta { font-size: 11.5px; color: var(--muted); line-height: 1.6; }
.acciones { display: flex; align-items: center; gap: var(--s-sm); flex: none; }
</style>
