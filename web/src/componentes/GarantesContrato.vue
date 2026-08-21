<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useUi } from '../stores/ui';
import { useAuth } from '../stores/auth';
import StatusChip from '../componentes/StatusChip.vue';
import { fecha, money, plural } from '../dominio/formato';

/**
 * Los garantes de un contrato: quiénes son, qué presentaron y qué dice el BCRA.
 *
 * Una inmobiliaria no alquila contra un nombre. Alquila contra dos o tres
 * personas con recibo de sueldo, sus documentos sobre la mesa y la certeza de
 * que no arrastran una deuda — y eso era una carpeta de papel y un WhatsApp con
 * fotos.
 *
 * Cuatro cosas que esta pantalla no hace y son a propósito:
 *
 * **No dice «apto» hasta que alguien consulte.** Sin consulta el chip dice «sin
 * verificar», que es distinto de «rechazado». Un legajo que nadie miró y uno
 * que dio mal no se pueden ver igual.
 *
 * **No esconde por qué.** Cuando el BCRA lo rechaza se muestra la entidad, la
 * situación y el monto: quien atiende tiene que poder explicárselo al inquilino
 * que trajo a ese garante.
 *
 * **No bloquea el contrato.** Informa lo que falta. Los contratos que ya
 * estaban cargados se hicieron sin esto, y un sistema que se niega a
 * representar la realidad que tiene enfrente no sirve.
 *
 * **No manda nada por WhatsApp.** El botón es un `<a href>` a `wa.me` que abre
 * el WhatsApp del usuario con el texto puesto: el sistema no envía, no guarda
 * «enviado» y no promete que llegó. El envío de verdad sigue necesitando la
 * verificación de negocio de la Cloud API, que es un trámite y no código —lo
 * mismo que dice la pantalla de Avisos—. Y si el número no se puede armar, el
 * botón queda deshabilitado con el motivo, porque un `wa.me` mal armado no
 * falla: abre el chat de otra persona y le manda los datos del inquilino.
 */

const props = withDefaults(
  defineProps<{
    contratoId: string;
    direccion?: string;
    /**
     * `false` cuando lo envuelve un `BloqueColapsable`: el card, el `<h2>` y el
     * chip de la cabecera los pone él, y dos bordes con dos títulos alrededor
     * del mismo contenido se leen como dos secciones distintas.
     *
     * El default es `true` para que las pantallas que ya lo usaban no cambien.
     */
    marco?: boolean;
  }>(),
  { marco: true },
);

/**
 * «Algo de acá movió un número de la cabecera».
 *
 * Sin esto, consultás el BCRA de un garante, queda apto, y la cabecera cerrada
 * de arriba sigue diciendo «1 de 2 · falta consultar el BCRA»: la cabecera
 * miente justo después de la acción que la contradice, que es el peor momento
 * posible.
 */
const emit = defineEmits<{ cambio: [] }>();

const ui = useUi();
const auth = useAuth();

interface Documento {
  id: string; tipo: string; etiqueta: string;
  /**
   * Siempre `null` en el listado desde la etapa 17.2.
   *
   * La URL firmada se pide de a una, al abrir, contra
   * `GET /garantes/documentos/:id`, y ese pedido queda auditado. Antes el
   * listado firmaba las cinco de cada garante y pintaba las miniaturas: abrir
   * el contrato para ver el monto del alquiler te ponía el DNI de dos personas
   * en pantalla, y «quién vio un DNI» no era una pregunta que se pudiera
   * contestar.
   */
  url: string | null;
  /** Si el archivo está subido. Es lo que pinta el casillero como completo. */
  cargado: boolean;
  nombreOriginal: string | null; subidoEl: string;
}

interface EntidadBcra {
  entidad: string; situacion: number; monto: number; diasAtrasoPago: number;
}

interface Cheque {
  causal: string; nroCheque: number | null; fechaRechazo: string | null;
  monto: number; fechaPago: string | null; estadoMulta: string | null;
}

interface Cheques {
  cantidad: number; sinPagar: number; montoTotal: number; montoSinPagar: number;
  porCausal: Array<{ causal: string; cantidad: number; monto: number }>;
  cheques: Cheque[]; resumen: string; advertencias: string[];
}

interface Garante {
  id: string;
  personaId: string | null;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  email: string | null;
  whatsapp: { numero: string | null; motivo: string | null };
  tipo: string;
  tipoTexto: string;
  detalle: string | null;
  venceEl: string | null;
  vencida: boolean;
  firmoEl: string | null;
  bcra: {
    consultado: boolean;
    cuit: string | null;
    denominacion: string | null;
    situacion: number | null;
    situacionTexto: string | null;
    periodo: string | null;
    consultadoEl: string | null;
    apto: boolean | null;
    motivo: string | null;
    entidades: EntidadBcra[];
    advertencias: string[];
    /** Cuándo se purgó el desglose por retención, si se purgó. */
    desglosePurgadoEl: string | null;
    revisarEl: string | null;
    revisionMemoria: string | null;
    revisionVencida: boolean;
    cheques: Cheques | null;
    chequesError: string | null;
    historial: {
      consultas: number;
      primera: { el: string; situacion: number | null; apto: boolean | null } | null;
      ultima: { el: string; situacion: number | null; apto: boolean | null } | null;
    };
  };
  documentos: Documento[];
  faltan: string[];
  legajoCompleto: boolean;
}

interface Verificacion {
  garantes: number; aptos: number; minimo: number;
  enRegla: boolean; pendientes: string[];
}

/** El orden en que se piden sobre el mostrador. */
const CASILLEROS = [
  { tipo: 'dni_frente', etiqueta: 'DNI · frente' },
  { tipo: 'dni_dorso', etiqueta: 'DNI · dorso' },
  { tipo: 'recibo_1', etiqueta: 'Recibo 1' },
  { tipo: 'recibo_2', etiqueta: 'Recibo 2' },
  { tipo: 'recibo_3', etiqueta: 'Recibo 3' },
] as const;

/**
 * Una garantía sin persona —una póliza de caución— no tiene DNI ni recibos de
 * sueldo: tiene un comprobante. Mostrarle los cinco casilleros sería pedirle
 * cinco cosas que nunca va a poder presentar.
 */
const CASILLERO_COMPROBANTE = [{ tipo: 'otro', etiqueta: 'La póliza' }] as const;

const garantes = ref<Garante[]>([]);
const verificacion = ref<Verificacion | null>(null);
const personas = ref<Array<{ id: string; nombreCompleto: string }>>([]);
const nuevaPersona = ref('');
const cargando = ref(true);
const error = ref('');
const consultando = ref<string | null>(null);
const subiendo = ref<string | null>(null);

/** El documento que se está abriendo, para no dejar el botón mudo. */
const abriendo = ref<string | null>(null);

/**
 * Pide la URL firmada y abre el documento.
 *
 * ── Por qué hace falta un clic ──
 *
 * Porque mirar el DNI de alguien pasó a ser un acto que se registra con nombre
 * y fecha (etapa 17.2, Ley 25.326). Mientras las miniaturas se pintaban solas
 * al abrir el contrato, no había nada que registrar: todos «veían» todos los
 * documentos todo el tiempo, y el registro habría dicho «entró al contrato»,
 * que no es lo mismo.
 *
 * De paso el DNI de dos personas deja de estar en pantalla mientras alguien
 * mira el monto del alquiler con un cliente al lado.
 *
 * `window.open` va ANTES del await: los navegadores bloquean la ventana que se
 * abre después de una promesa porque ya no la asocian al clic. Se abre vacía y
 * se le pone la URL cuando llega.
 */
async function abrirDocumento(d: Documento) {
  abriendo.value = d.id;
  const ventana = window.open('', '_blank', 'noopener,noreferrer');
  try {
    const { url } = await api<{ url: string }>(`/garantes/documentos/${d.id}`);
    if (ventana) ventana.location.href = url;
    else window.location.href = url;
  } catch (e) {
    ventana?.close();
    ui.error(e instanceof ApiError ? e.paraMostrar : 'No se pudo abrir el documento.');
  } finally {
    abriendo.value = null;
  }
}
const guardandoVence = ref<string | null>(null);

/** El panel de WhatsApp abierto, y el texto editado de cada garante. */
const chatAbierto = ref<string | null>(null);
const mensajes = reactive<Record<string, string>>({});

const disponibles = computed(() => {
  const yaEstan = new Set(garantes.value.map((g) => g.nombre));
  return personas.value.filter((p) => !yaEstan.has(p.nombreCompleto));
});

function casillerosDe(g: Garante) {
  return g.personaId ? CASILLEROS : CASILLERO_COMPROBANTE;
}

function docDe(g: Garante, tipo: string): Documento | undefined {
  return g.documentos.find((d) => d.tipo === tipo);
}

function etiquetaFaltante(g: Garante): string {
  const nombres = g.faltan.map(
    (t) => casillerosDe(g).find((c) => c.tipo === t)?.etiqueta ?? t,
  );
  return nombres.join(', ');
}

/**
 * El texto que se abre en WhatsApp.
 *
 * Dice quién escribe, por qué, qué falta y una pregunta concreta. Va editable
 * antes de abrir el chat: lo que se manda queda a la vista de quien lo manda, y
 * cada inmobiliaria escribe distinto. El mismo texto es el que copia el botón
 * de al lado, así que no hay dos versiones del mensaje.
 */
function mensajeDe(g: Garante): string {
  const inmo = auth.tenant?.nombre ?? 'la inmobiliaria';
  const nombre = g.nombre.split(' ')[0];
  const donde = props.direccion ? ` del alquiler de ${props.direccion}` : '';

  const partes = [`Hola ${nombre}, te escribo de ${inmo}.`];
  partes.push(`Estamos completando la carpeta de garantía${donde}.`);

  if (!g.firmoEl) partes.push('Nos falta tu firma del contrato.');
  if (g.faltan.length) {
    partes.push(
      `${g.firmoEl ? 'Nos falta' : 'También nos falta'} que nos acerques: ${etiquetaFaltante(g)}.`,
    );
  }
  if (g.firmoEl && !g.faltan.length) {
    partes.push('Tenemos todo tu legajo, era para confirmarte que quedó cerrado.');
  }

  partes.push('¿Qué día te queda cómodo para pasar por la oficina?');
  return partes.join(' ');
}

function textoDe(g: Garante): string {
  return mensajes[g.id] ?? mensajeDe(g);
}

function enlaceWa(g: Garante): string {
  return `https://wa.me/${g.whatsapp.numero}?text=${encodeURIComponent(textoDe(g))}`;
}

function enlaceMail(g: Garante): string {
  const asunto = `Garantía del alquiler${props.direccion ? ` de ${props.direccion}` : ''}`;
  return `mailto:${g.email}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(textoDe(g))}`;
}

function abrirChat(g: Garante) {
  if (chatAbierto.value === g.id) { chatAbierto.value = null; return; }
  if (mensajes[g.id] === undefined) mensajes[g.id] = mensajeDe(g);
  chatAbierto.value = g.id;
}

async function copiarTexto(g: Garante) {
  try {
    await navigator.clipboard.writeText(textoDe(g));
    ui.ok('Copiado', 'Pegalo en el chat o en el mail que uses.');
  } catch {
    ui.error('No se pudo copiar', 'Seleccioná el texto del recuadro y copialo a mano.');
  }
}

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const [gs, v, ps] = await Promise.all([
      api<Garante[]>(`/contratos/${props.contratoId}/garantes`),
      api<Verificacion>(`/contratos/${props.contratoId}/garantes/verificacion`),
      api<{ items: Array<{ id: string; nombreCompleto: string }> }>('/personas?porPagina=100'),
    ]);
    garantes.value = gs; verificacion.value = v; personas.value = ps.items;
    // El texto se recalcula con el legajo nuevo, salvo el que alguien ya editó.
    for (const g of gs) if (mensajes[g.id] === undefined) mensajes[g.id] = mensajeDe(g);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los garantes.';
  } finally { cargando.value = false; }
}

/**
 * Recarga el legajo Y avisa hacia arriba.
 *
 * Todo lo que MUTA pasa por acá; `cargar()` a secas queda para la carga
 * inicial, que no cambió ningún número y no tiene a quién avisarle.
 */
async function recargar() {
  await cargar();
  emit('cambio');
}

async function agregar() {
  if (!nuevaPersona.value) return;
  try {
    await api(`/contratos/${props.contratoId}/garantes`, {
      method: 'POST',
      body: JSON.stringify({ personaId: nuevaPersona.value }),
    });
    nuevaPersona.value = '';
    await recargar();
  } catch (e) {
    ui.error('No se pudo agregar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  }
}

async function consultarBcra(g: Garante) {
  consultando.value = g.id;
  try {
    const r = await api<Garante>(`/garantes/${g.id}/bcra`, { method: 'POST' });
    await recargar();
    if (r.bcra.apto) ui.ok(`${g.nombre}: apto`, r.bcra.motivo ?? undefined);
    else ui.error(`${g.nombre}: no apto`, r.bcra.motivo ?? undefined);
    if (r.bcra.chequesError) ui.info('Cheques rechazados', r.bcra.chequesError);
  } catch (e) {
    ui.error('No se pudo consultar el BCRA', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally { consultando.value = null; }
}

/**
 * El archivo va en base64, igual que las fotos de una propiedad. La foto de un
 * DNI sacada con el teléfono pasa los 3 MB sin esfuerzo, y por eso esa ruta
 * tiene su propio límite de body.
 */
async function subir(g: Garante, tipo: string, ev: Event) {
  const input = ev.target as HTMLInputElement;
  const archivo = input.files?.[0];
  if (!archivo) return;

  subiendo.value = `${g.id}:${tipo}`;
  try {
    const datos = await new Promise<string>((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result));
      lector.onerror = () => reject(new Error('No se pudo leer el archivo'));
      lector.readAsDataURL(archivo);
    });

    await api(`/garantes/${g.id}/documentos`, {
      method: 'POST',
      body: JSON.stringify({ tipo, datos, nombre: archivo.name }),
    });
    await recargar();
  } catch (e) {
    ui.error('No se pudo subir', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally {
    subiendo.value = null;
    input.value = '';
  }
}

async function firmo(g: Garante) {
  try {
    await api(`/garantes/${g.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ firmoEl: new Date().toISOString().slice(0, 10) }),
    });
    await recargar();
  } catch (e) {
    ui.error('No se pudo guardar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  }
}

/**
 * El vencimiento de la garantía.
 *
 * Sin este campo la columna `vence_el` existía en la base y en el DTO y **no la
 * llenaba ninguna pantalla**, así que el recordatorio `garantia_por_vencer` no
 * tenía sobre qué disparar. Vaciarlo manda `null` a propósito: una fecha mal
 * tipeada que no se puede sacar deja avisando para siempre.
 */
async function guardarVence(g: Garante, ev: Event) {
  const valor = (ev.target as HTMLInputElement).value || null;
  if (valor === g.venceEl) return;

  guardandoVence.value = g.id;
  try {
    await api(`/garantes/${g.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ venceEl: valor }),
    });
    await recargar();
    ui.ok(
      valor ? 'Vencimiento guardado' : 'Vencimiento borrado',
      valor
        ? 'El aviso de garantía por vencer se genera al recalcular en Avisos.'
        : 'Ya no se va a avisar por esta garantía.',
    );
  } catch (e) {
    ui.error('No se pudo guardar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally { guardandoVence.value = null; }
}

async function quitar(g: Garante) {
  if (!(await ui.confirmar({
    titulo: `¿Quitar a ${g.nombre} como garante?`,
    detalle: 'Se borran también sus documentos y sus avisos. No se puede deshacer.',
    confirmar: 'Quitar',
    peligroso: true,
  }))) return;

  try {
    await api(`/garantes/${g.id}`, { method: 'DELETE' });
    await recargar();
  } catch (e) {
    ui.error('No se pudo quitar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  }
}

onMounted(cargar);
/**
 * Los pendientes que ESTE bloque tiene que mostrar.
 *
 * Enmarcado por fuera (`marco: false`), el primero ya lo muestra el envoltorio
 * al lado del título; acá van del segundo en adelante. Con marco propio, van
 * todos, porque la cabecera de acá sólo pone el chip.
 */
const pendientesPropios = computed(() => {
  const p = verificacion.value?.pendientes ?? [];
  return props.marco ? p : p.slice(1);
});
</script>

<template>
  <section class="stack" :class="{ card: marco }">
    <!-- Con `marco: false` el card, el título y el chip los pone el
         `BloqueColapsable` que lo envuelve. -->
    <header v-if="marco" class="cabecera">
      <h2>Garantes</h2>
      <StatusChip
        v-if="verificacion"
        :texto="verificacion.enRegla
          ? `${verificacion.aptos} en regla`
          : `${verificacion.aptos} de ${verificacion.minimo} en regla`"
        :tono="verificacion.enRegla ? 'ok' : 'warn'" />
    </header>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <!--
      Sin el primer pendiente cuando el bloque va enmarcado por fuera.

      Con `marco: false` el `BloqueColapsable` que lo envuelve ya muestra el
      chip Y el primer pendiente al lado del título. Repetirlo acá abajo hacía
      que «Faltan garantes: hay 0 y el mínimo es 2» apareciera dos veces con
      cuarenta píxeles de diferencia, y que el bloque abierto no dijera nada que
      el cerrado no dijera.

      Es la misma regla que las señales de la conciliación: lo que ya está
      dicho no se vuelve a decir.
    -->
    <ul v-if="pendientesPropios.length" class="pendientes">
      <li v-for="p in pendientesPropios" :key="p">{{ p }}</li>
    </ul>

    <p v-if="!cargando && !garantes.length" class="vacio">
      Este contrato no tiene garantes cargados. Se piden {{ verificacion?.minimo ?? 2 }}
      con recibo de sueldo.
    </p>

    <article v-for="g in garantes" :key="g.id" class="garante">
      <header class="fila">
        <div class="quien">
          <strong>{{ g.nombre }}</strong>
          <span class="sub">
            <span v-if="g.documento" class="mono">DNI {{ g.documento }}</span>
            <span v-if="g.documento"> · </span>{{ g.tipoTexto }}
          </span>
        </div>

        <!-- Sin persona no hay documento con el que consultar la Central de
             Deudores: mostrar «sin verificar» sobre una póliza sería pedir algo
             que nadie puede hacer. -->
        <template v-if="g.personaId">
          <StatusChip v-if="!g.bcra.consultado" texto="Sin verificar" tono="warn" />
          <StatusChip
            v-else-if="g.bcra.apto"
            :texto="`BCRA situación ${g.bcra.situacion ?? '—'}`" tono="ok" />
          <StatusChip v-else :texto="`BCRA situación ${g.bcra.situacion}`" tono="err" />
          <StatusChip v-if="g.bcra.revisionVencida" texto="Revisión vencida" tono="warn" />
        </template>

        <StatusChip
          :texto="g.legajoCompleto ? 'Legajo completo' : `Faltan ${g.faltan.length}`"
          :tono="g.legajoCompleto ? 'ok' : 'warn'" />

        <StatusChip
          v-if="g.personaId"
          :texto="g.firmoEl ? `Firmó ${fecha(g.firmoEl)}` : 'Sin firmar'"
          :tono="g.firmoEl ? 'ok' : 'warn'" />

        <StatusChip v-if="g.vencida" :texto="`Vencida ${fecha(g.venceEl)}`" tono="err" />

        <div class="acciones">
          <button v-if="g.personaId" class="btn secondary sm" type="button"
            :disabled="consultando === g.id" @click="consultarBcra(g)">
            {{ consultando === g.id
              ? 'Consultando…'
              : (g.bcra.consultado ? 'Volver a consultar' : 'Consultar BCRA') }}
          </button>
          <button v-if="g.personaId" class="btn secondary sm" type="button"
            :class="{ activo: chatAbierto === g.id }" @click="abrirChat(g)">
            WhatsApp
          </button>
          <button v-if="g.personaId && !g.firmoEl" class="btn secondary sm" type="button"
            @click="firmo(g)">
            Firmó
          </button>
          <button class="btn secondary sm" type="button" @click="quitar(g)">Quitar</button>
        </div>
      </header>

      <p v-if="g.detalle" class="detalle">{{ g.detalle }}</p>

      <!-- ── Coordinar por WhatsApp ─────────────────────────────────────────
           Un <a href> de verdad, no un botón que simula un envío. Cuando el
           número no se puede armar, en vez del enlace va el motivo: un wa.me
           incompleto abre el chat de otra persona. -->
      <div v-if="chatAbierto === g.id" class="chat">
        <label class="campo">
          <span>Mensaje</span>
          <textarea v-model="mensajes[g.id]" rows="4"></textarea>
        </label>

        <p class="aclaracion">
          Se abre tu WhatsApp con el texto puesto. El sistema no envía nada ni
          registra el envío: la Cloud API de WhatsApp necesita verificación de
          negocio, y eso es un trámite.
        </p>

        <div class="acciones">
          <a v-if="g.whatsapp.numero" class="btn primary sm" :href="enlaceWa(g)"
            target="_blank" rel="noopener">
            Abrir WhatsApp de {{ g.telefono }}
          </a>
          <template v-else>
            <button class="btn primary sm" type="button" disabled>Abrir WhatsApp</button>
            <span class="motivo">{{ g.whatsapp.motivo }}</span>
          </template>

          <a v-if="g.email" class="btn secondary sm" :href="enlaceMail(g)">
            Escribir a {{ g.email }}
          </a>
          <button class="btn secondary sm" type="button" @click="copiarTexto(g)">
            Copiar el texto
          </button>
        </div>
      </div>

      <!-- ── El veredicto del BCRA ──────────────────────────────────────────
           «Aceptado el …» es la consulta que respaldó la firma —la primera del
           historial— y «última revisión» es la foto de hoy. Con una sola fecha
           no se puede distinguir un legajo revisado la semana pasada de uno que
           nadie volvió a mirar en tres años. -->
      <p v-if="g.bcra.consultado" class="veredicto" :class="{ mal: g.bcra.apto === false }">
        {{ g.bcra.motivo }}
        <span class="cuando">
          <!-- CUIT/CUIL y no «CUIL» a secas: del DNI de una persona se deriva
               un CUIL, pero una sociedad se consulta con su CUIT y la etiqueta
               tiene que servir para los dos. -->
          · {{ g.bcra.denominacion }} · CUIT/CUIL {{ g.bcra.cuit }}
          <template v-if="g.bcra.historial.primera">
            · aceptado el {{ fecha(g.bcra.historial.primera.el) }}
          </template>
          · última revisión {{ fecha(g.bcra.consultadoEl) }}
          <template v-if="g.bcra.historial.consultas > 1">
            ({{ plural(g.bcra.historial.consultas, 'consulta', 'consultas') }})
          </template>
        </span>
      </p>

      <p v-if="g.bcra.consultado && g.bcra.revisionMemoria" class="memoria">
        {{ g.bcra.revisionMemoria }}
      </p>

      <ul v-if="g.bcra.advertencias.length" class="advertencias">
        <li v-for="a in g.bcra.advertencias" :key="a">{{ a }}</li>
      </ul>

      <!-- ── Cheques rechazados ─────────────────────────────────────────────
           No cambian el apto/no apto —la regla es la situación de la Central de
           Deudores— pero un cheque sin fondos sin levantar es exactamente lo que
           alguien quiere ver antes de firmar. -->
      <p v-if="g.bcra.consultado && g.bcra.cheques" class="cheques"
        :class="{ mal: g.bcra.cheques.sinPagar > 0 }">
        {{ g.bcra.cheques.resumen }}
      </p>
      <p v-else-if="g.bcra.chequesError" class="cheques aviso">
        {{ g.bcra.chequesError }}
      </p>

      <ul v-if="g.bcra.cheques && g.bcra.cheques.advertencias.length" class="advertencias">
        <li v-for="a in g.bcra.cheques.advertencias" :key="a">{{ a }}</li>
      </ul>

      <details v-if="g.bcra.cheques && g.bcra.cheques.cantidad">
        <summary>
          Detalle de los cheques ·
          {{ plural(g.bcra.cheques.cantidad, 'cheque', 'cheques') }}
        </summary>
        <table class="entidades">
          <thead>
            <tr><th>Causal</th><th>Cheque</th><th>Rechazado</th><th>Monto</th><th>Estado</th></tr>
          </thead>
          <tbody>
            <tr v-for="(ch, i) in g.bcra.cheques.cheques" :key="`${ch.nroCheque}-${i}`">
              <td>{{ ch.causal }}</td>
              <td class="mono">{{ ch.nroCheque ?? '—' }}</td>
              <td>{{ fecha(ch.fechaRechazo) }}</td>
              <td class="num">{{ money(ch.monto, 'ARS') }}</td>
              <td>{{ ch.fechaPago ? `Pagado ${fecha(ch.fechaPago)}` : 'Sin levantar' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="aclaracion">
          El BCRA informa el banco como un número de agrupamiento, no como
          nombre: de estos cheques no se puede saber de qué entidad son.
        </p>
      </details>

      <!-- Se dice que el desglose se purgó, en vez de esconder el bloque y
           dejar creyendo que nunca hubo detalle. El veredicto sigue arriba. -->
      <p v-if="g.bcra.desglosePurgadoEl" class="purgado">
        El desglose banco por banco se borró el {{ fecha(g.bcra.desglosePurgadoEl) }}
        por la política de retención de datos personales. El veredicto y su
        motivo se conservan.
      </p>

      <details v-if="g.bcra.entidades.length">
        <summary>Detalle del BCRA · {{ g.bcra.entidades.length }} entidad(es)</summary>
        <table class="entidades">
          <thead>
            <tr><th>Entidad</th><th>Situación</th><th>Deuda informada</th><th>Atraso</th></tr>
          </thead>
          <tbody>
            <tr v-for="e in g.bcra.entidades" :key="e.entidad">
              <td>{{ e.entidad }}</td>
              <td>{{ e.situacion }}</td>
              <td class="num">{{ money(e.monto, 'ARS') }}</td>
              <td class="num">{{ e.diasAtrasoPago }} días</td>
            </tr>
          </tbody>
        </table>
      </details>

      <div class="casilleros">
        <div v-for="c in casillerosDe(g)" :key="c.tipo" class="casillero"
          :class="{ cargado: !!docDe(g, c.tipo) }">
          <!-- Cargado, pero NO en pantalla. El casillero dice que está; verlo
               es un clic, y ese clic queda registrado. -->
          <button
            v-if="docDe(g, c.tipo)"
            type="button"
            class="miniatura"
            :disabled="abriendo === docDe(g, c.tipo)!.id"
            :title="`Ver ${c.etiqueta} — el acceso queda registrado`"
            @click="abrirDocumento(docDe(g, c.tipo)!)"
          >
            <span class="ojo" aria-hidden="true">👁</span>
            <span class="ver">{{ abriendo === docDe(g, c.tipo)!.id ? 'Abriendo…' : 'Ver' }}</span>
          </button>
          <span v-else class="hueco" aria-hidden="true">+</span>

          <label class="pie">
            <span>{{ c.etiqueta }}</span>
            <input type="file" accept="image/*" :disabled="subiendo === `${g.id}:${c.tipo}`"
              @change="subir(g, c.tipo, $event)" />
          </label>
        </div>
      </div>

      <label class="campo vence">
        <span>Vence el</span>
        <input type="date" :value="g.venceEl ?? ''" :disabled="guardandoVence === g.id"
          @change="guardarVence(g, $event)" />
        <small>
          Para pólizas y avales con fecha. Se avisa 30 días antes; vaciarlo deja
          de avisar.
        </small>
      </label>
    </article>

    <form class="agregar" @submit.prevent="agregar">
      <label class="campo"><span>Agregar garante</span>
        <select v-model="nuevaPersona">
          <option value="">Elegí una persona…</option>
          <option v-for="p in disponibles" :key="p.id" :value="p.id">{{ p.nombreCompleto }}</option>
        </select>
      </label>
      <button class="btn secondary" type="submit" :disabled="!nuevaPersona">Agregar</button>
    </form>
  </section>
</template>

<style scoped>
.cabecera { display: flex; align-items: center; gap: var(--s-md); }
.cabecera h2 { margin: 0; }
.pendientes { margin: 0; padding-left: 1.2em; font-size: 13px; color: var(--warning); line-height: 1.7; }
.vacio { margin: 0; font-size: 13px; color: var(--muted); }
.garante { border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--s-md); display: flex; flex-direction: column; gap: var(--s-md); }
.fila { display: flex; align-items: center; gap: var(--s-sm); flex-wrap: wrap; }
.quien { display: flex; flex-direction: column; margin-right: auto; }
.sub { font-size: 12px; color: var(--muted); }
.detalle { margin: 0; font-size: 13px; color: var(--ink-2); }
.acciones { display: flex; gap: var(--s-xs); flex-wrap: wrap; align-items: center; }
.acciones .activo { border-color: var(--acento); }
.chat { border: 1px solid var(--line); border-radius: var(--r-sm); padding: var(--s-md); display: flex; flex-direction: column; gap: var(--s-sm); background: var(--surface-2); }
.chat textarea { width: 100%; font: inherit; font-size: 13px; line-height: 1.6; }
.aclaracion { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.6; }
.motivo { font-size: 12px; color: var(--warning); max-width: 46ch; line-height: 1.5; }
.veredicto { margin: 0; font-size: 13px; color: var(--ink-2); line-height: 1.6; }
.veredicto.mal { color: var(--danger); }
/* `.memoria` es capa familia (DESIGN.md §5): mono sobre `--surface-2`, igual
   que la memoria de un ajuste. Acá sólo se le saca el margen del <p>. */
.memoria { margin: 0; }
.cuando { color: var(--muted); font-size: 12px; }
.cheques { margin: 0; font-size: 13px; color: var(--ink-2); line-height: 1.6; }
.cheques.mal { color: var(--danger); }
.cheques.aviso { color: var(--warning); }
.advertencias { margin: 0; padding-left: 1.2em; font-size: 12px; color: var(--warning); }
.miniatura {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px; width: 100%; aspect-ratio: 4 / 3; cursor: pointer;
  border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: var(--surface-2); color: var(--muted); font: inherit; font-size: 12px;
}
.miniatura:hover:not(:disabled) { border-color: var(--accent); color: var(--ink); }
.miniatura:disabled { cursor: progress; }
.ojo { font-size: 18px; line-height: 1; }

.purgado {
  margin: var(--s-sm) 0 0; font-size: 12px; color: var(--muted);
  max-width: 70ch; line-height: 1.6;
}

.entidades { width: 100%; border-collapse: collapse; margin-top: var(--s-sm); font-size: 13px; }
.entidades th, .entidades td { padding: var(--s-xs) var(--s-sm); text-align: left; border-bottom: 1px solid var(--line); }
.entidades thead th { font-size: 12px; color: var(--muted); font-weight: 500; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.casilleros { display: flex; gap: var(--s-sm); flex-wrap: wrap; }
.casillero { width: 116px; border: 1px dashed var(--line); border-radius: var(--r-sm); overflow: hidden; display: flex; flex-direction: column; }
.casillero.cargado { border-style: solid; }
.miniatura, .hueco { display: flex; align-items: center; justify-content: center; height: 78px; background: var(--surface-2); }
.miniatura img { width: 100%; height: 100%; object-fit: cover; }
.hueco { color: var(--muted); font-size: 20px; }
.pie { display: block; padding: var(--s-xs) var(--s-sm); font-size: 11px; color: var(--ink-2); cursor: pointer; }
.pie input { display: block; width: 100%; font-size: 10px; margin-top: 2px; }
.vence { max-width: 340px; }
.vence small { display: block; margin-top: 2px; font-size: 11px; color: var(--muted); line-height: 1.5; }
.agregar { display: flex; align-items: flex-end; gap: var(--s-sm); }
.agregar .campo { flex: 1; max-width: 340px; }
</style>
