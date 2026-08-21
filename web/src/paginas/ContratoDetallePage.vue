<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import { useUi } from '../stores/ui';
import { useAuth } from '../stores/auth';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import BloqueColapsable from '../componentes/BloqueColapsable.vue';
import PanelNotas from '../componentes/PanelNotas.vue';
import PanelDocumentos from '../componentes/PanelDocumentos.vue';
import GarantesContrato from '../componentes/GarantesContrato.vue';
import ActasContrato from '../componentes/ActasContrato.vue';
import ComisionContrato from '../componentes/ComisionContrato.vue';
import { bloquesRecordados } from '../dominio/bloques';
import {
  fecha, fechaHora, money, periodo as fmtPeriodo, proximidad, plural,
} from '../dominio/formato';
import type { Pagina } from '../dominio/pagina';

/**
 * La ficha de un contrato: siete bloques que se pliegan y recuerdan cómo
 * quedaron.
 *
 * Antes era una columna de siete tarjetas abiertas: para llegar al seguimiento
 * había que pasar por los garantes, la comisión, los aumentos y treinta cuotas.
 * Y montarlas todas eran once requests al abrir la pantalla, incluso las que
 * nadie iba a mirar.
 *
 * ── Tres decisiones que sostienen el resto ──
 *
 * **El resumen de cada cabecera sale de `GET /contratos/:id/ficha`, no de los
 * hijos.** Es lo que hace posible que un bloque cerrado no monte: si para decir
 * «3 impagas» hubiera que montar el bloque de cuotas, plegarlo no habría
 * ahorrado nada. Y los conteos vienen de `count()` en SQL, no de contar la
 * página de 100 — ver la trampa de abajo.
 *
 * **Los defaults son estáticos.** Se rechazó el default dinámico («Garantes
 * abierto si no está en regla»): dos fichas que se ven distinto por un motivo
 * que el usuario no ve es peor que un chip rojo en una cabecera cerrada. La
 * urgencia va en el chip, no en el layout.
 *
 * **Todo lo que un hijo cambia vuelve a pedir el resumen** (`@cambio`). Sin eso
 * cobrás una cuota adentro del bloque y la cabecera de arriba sigue diciendo «3
 * impagas»: la cabecera miente justo después de la acción que la contradice.
 *
 * ── La trampa que esta pantalla tenía y ahora se dice ──
 * Ajustes y cuotas se piden con `?porPagina=100` porque `PaginacionDto` topea
 * ahí, y el `total` que devolvía la API se descartaba. «Un contrato de diez años
 * son 120 cuotas»: veinte desaparecían sin ninguna señal. Ahora el `total` se
 * guarda, el bloque abierto dice «se muestran 100 de 120» y los números de la
 * cabecera vienen del endpoint, que cuenta todo.
 */

interface Ajuste {
  id: string; vigenteDesde: string; indiceTipo: string; coeficiente: number;
  montoAnterior: number; montoNuevo: number; moneda: string; estado: string;
  explicacion: string | null;
}
interface Periodo {
  id: string; periodo: string; venceEl: string; montoAlquiler: number;
  expensas: number; total: number; moneda: string; estado: string;
  cobrado: number; saldo: number;
}
interface Contrato {
  id: string; propiedad: { etiqueta: string; direccion: string };
  fechaInicio: string; fechaFin: string; montoInicial: number; montoVigente: number;
  moneda: string; indice: string; periodicidadMeses: number; administrado: boolean;
  honorariosPct: number; estado: string;
  locadores: Array<{ nombre: string; porcentaje: number | null }>;
  locatarios: Array<{ nombre: string }>;
}

interface Importe { monto: number; moneda: string }
interface AjusteResumen {
  vigenteDesde: string; montoAnterior: number; montoNuevo: number;
  moneda: string; estado: string;
}
interface Ficha {
  contratoId: string;
  garantes: {
    total: number; aptos: number; minimo: number; enRegla: boolean;
    pendientes: number; primerPendiente: string | null;
  };
  cuotas: {
    generadas: number; impagas: number; vencidas: number;
    deuda: Importe; proximaVence: string | null;
  } | null;
  aumentos: {
    total: number; proyectados: number;
    proximo: AjusteResumen | null; atrasado: AjusteResumen | null;
  };
  comision: { armada: boolean; repartida: boolean; sinCobrar: number; total: Importe | null };
  documentos: { total: number; sinMandar: number; ultimoEl: string | null };
  notas: { total: number; pendientes: number; ultimaEl: string | null };
}

const route = useRoute();
const ui = useUi();
const auth = useAuth();
const id = route.params.id as string;

/**
 * `?nuevo=1`: se acaba de crear el contrato desde el formulario.
 *
 * Abre los tres bloques que se miran recién firmado —garantes, comisión y
 * pre-contrato— **sólo para esta visita**, sin escribir la preferencia. Es una
 * apertura de cortesía, no una decisión de la persona: guardarla haría que la
 * próxima ficha, la de un contrato de hace dos años, apareciera con tres
 * bloques abiertos que nadie pidió.
 */
const esNuevo = route.query.nuevo === '1';

const c = ref<Contrato | null>(null);
const ficha = ref<Ficha | null>(null);
const ajustes = ref<Ajuste[]>([]);
const ajustesTotal = ref(0);
const periodos = ref<Periodo[]>([]);
const periodosTotal = ref(0);
const cargando = ref(true);
const error = ref('');
const aviso = ref('');
const cobrando = ref<string | null>(null);
const montoCobro = ref('');

const PAGINA = 100;

/**
 * Cómo arranca cada bloque. Ver la tabla del comentario de arriba: estático, y
 * la urgencia va en el chip.
 *
 * `cuotas` está en el mapa aunque un contrato de intermediación no lo dibuje:
 * la regla 3 de `bloques.ts` descarta sin ruido el id que sobra, y sacarlo del
 * mapa haría que la preferencia de las cuotas se perdiera al mirar un contrato
 * no administrado en el medio.
 */
const DEFECTO: Record<string, boolean> = {
  resumen: true,      // Es la identidad del contrato.
  garantes: false,    // Se arma una vez, al principio.
  comision: false,    // Se acuerda una vez, al firmar.
  aumentos: true,     // Es lo que se mira y lo que se le explica al inquilino.
  cuotas: true,       // Es la razón por la que se entra a la ficha: cobrar.
  documentos: false,  // Se genera una vez, y es el bloque más caro de montar.
  // Se llena dos veces en la vida del contrato —al entregar y al devolver— y en
  // el medio no se toca. Pero cuando se abre, se abre con el inquilino
  // enfrente: por eso está, y por eso arranca cerrado.
  actas: false,
  seguimiento: false, // Se consulta cuando hay un problema.
};

const bloques = bloquesRecordados('contrato', DEFECTO, auth.usuario?.id);
const abiertos = bloques.abiertos;
if (esNuevo) bloques.abrirDeCortesia(['garantes', 'comision', 'documentos']);

const ETIQUETA_ESTADO_AJ: Record<string, string> = {
  proyectado: 'Proyectado', confirmado: 'Confirmado', notificado: 'Notificado', aplicado: 'Aplicado',
};
const ETIQUETA_ESTADO_PER: Record<string, string> = {
  pendiente: 'Pendiente', parcial: 'Parcial', pagado: 'Pagado', vencido: 'Vencido', condonado: 'Condonado',
};

/**
 * El día de un `timestamptz`, en la zona de Argentina.
 *
 * `fecha()` es para columnas `date` puras: aplicada a un instante ISO recorta el
 * prefijo en UTC, y un documento generado a las 22:30 de Mendoza se mostraría
 * del día siguiente.
 */
function dia(iso: string | null | undefined): string {
  return iso ? fechaHora(iso).split(',')[0] : '—';
}

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const [ct, fi, aj, pe] = await Promise.all([
      api<Contrato>(`/contratos/${id}`),
      api<Ficha>(`/contratos/${id}/ficha`),
      // Las dos vienen paginadas y `PaginacionDto` topea en 100. El `total` se
      // GUARDA: descartarlo es lo que hacía que veinte cuotas de un contrato
      // largo desaparecieran sin decirlo.
      api<Pagina<Ajuste>>(`/contratos/${id}/ajustes?porPagina=${PAGINA}`),
      api<Pagina<Periodo>>(`/contratos/${id}/periodos?porPagina=${PAGINA}`),
    ]);
    c.value = ct;
    ficha.value = fi;
    ajustes.value = aj.items; ajustesTotal.value = aj.total;
    periodos.value = pe.items; periodosTotal.value = pe.total;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar el contrato.';
  } finally { cargando.value = false; }
}

/**
 * Sólo el resumen de las cabeceras.
 *
 * Lo llaman los `@cambio` de los cuatro paneles hijos: cada uno ya recargó lo
 * suyo, así que volver a pedir el contrato entero, los ajustes y las cuotas
 * serían tres viajes para redibujar lo mismo. Y si falla, la cabecera se queda
 * con el número anterior en vez de vaciarse: un dato de hace diez segundos es
 * mejor que un guión.
 */
async function refrescarFicha() {
  try {
    ficha.value = await api<Ficha>(`/contratos/${id}/ficha`);
  } catch {
    // Silencio a propósito: el bloque abierto ya muestra la verdad.
  }
}

async function proyectar() {
  error.value = ''; aviso.value = '';
  try {
    const r = await api<{ creados: number; sinIndice: string[] }>(
      `/contratos/${id}/ajustes/proyectar`, { method: 'POST' });
    aviso.value = r.sinIndice.length
      ? `${r.creados} ajuste(s) calculado(s). Falta el índice para ${r.sinIndice.map((f) => fecha(f)).join(', ')} — cargalo en Índices.`
      : `${plural(r.creados, 'ajuste calculado', 'ajustes calculados')}.`;
    await cargar();
  } catch (e) { error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo proyectar.'; }
}

/**
 * Confirmar un ajuste es **irreversible por trigger**: los números quedan
 * congelados aunque INDEC después revise el índice. Es un acto en el que una
 * persona se hace cargo del número, así que se confirma con el número a la vista.
 */
async function confirmar(ajusteId: string) {
  error.value = '';
  const a = ajustes.value.find((x) => x.id === ajusteId);

  const ok = await ui.confirmar({
    titulo: '¿Confirmar el aumento?',
    detalle: a
      ? `Pasa de ${money(a.montoAnterior, a.moneda)} a ${money(a.montoNuevo, a.moneda)} ` +
        `desde el ${fecha(a.vigenteDesde)}. Una vez confirmado no se recalcula, ` +
        'ni siquiera si después se corrige el índice.'
      : 'Una vez confirmado no se recalcula.',
    confirmar: 'Confirmar el aumento',
  });
  if (!ok) return;

  try {
    await api(`/ajustes/${ajusteId}/confirmar`, { method: 'POST' });
    await cargar();
    ui.ok('Aumento confirmado', a ? money(a.montoNuevo, a.moneda) : undefined);
  } catch (e) {
    const detalle = e instanceof ApiError ? e.paraMostrar : 'No se pudo confirmar.';
    error.value = detalle;
    ui.error('No se pudo confirmar el aumento', detalle);
  }
}

async function generarPeriodos() {
  error.value = '';
  try { await api(`/contratos/${id}/periodos/generar`, { method: 'POST', body: '{}' }); await cargar(); }
  catch (e) { error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron generar.'; }
}

async function cobrar(periodoId: string) {
  error.value = '';
  const monto = Number(montoCobro.value);
  const p = periodos.value.find((x) => x.id === periodoId);

  try {
    await api('/cobros', {
      method: 'POST',
      body: JSON.stringify({ periodoId, monto }),
    });
    cobrando.value = null; montoCobro.value = '';
    await cargar();
    // El toast lleva el MONTO: es lo que permite ver un cero de más ahora y no
    // a fin de mes, cuando ya se liquidó.
    ui.ok('Cobro registrado', money(monto, p?.moneda ?? c.value?.moneda ?? 'ARS'));
  } catch (e) {
    const detalle = e instanceof ApiError ? e.paraMostrar : 'No se pudo registrar el cobro.';
    error.value = detalle;
    ui.error('No se pudo registrar el cobro', detalle);
  }
}

// ── Lo que dice cada cabecera cerrada ────────────────────────────────────────
// Esto es lo que decide si la feature sirve: una cabecera que no dice nada es
// un bloque escondido, no un bloque plegado.

const resumenCuotas = computed(() => {
  const q = ficha.value?.cuotas;
  if (!q) return null;
  if (q.vencidas > 0) {
    return {
      texto: `${plural(q.vencidas, 'cuota vencida', 'cuotas vencidas')} · ${money(q.deuda.monto, q.deuda.moneda)}`,
      tono: 'err' as const,
    };
  }
  if (q.impagas > 0) {
    return {
      texto: `${plural(q.impagas, 'cuota por cobrar', 'cuotas por cobrar')} · ${money(q.deuda.monto, q.deuda.moneda)}`
        + (q.proximaVence ? ` · vence el ${fecha(q.proximaVence)}` : ''),
      tono: 'warn' as const,
    };
  }
  if (q.generadas === 0) return { texto: 'Sin cuotas generadas', tono: 'neutro' as const };
  return { texto: `Al día · ${plural(q.generadas, 'cuota', 'cuotas')}`, tono: 'ok' as const };
});

const resumenAumentos = computed(() => {
  const a = ficha.value?.aumentos;
  if (!a) return null;
  // El proyectado cuya vigencia YA empezó va primero y en rojo: es plata que no
  // se está cobrando todos los meses, y en el listado se ve igual que los demás.
  if (a.atrasado) {
    return {
      texto: `Rige desde el ${fecha(a.atrasado.vigenteDesde)} y sin confirmar · `
        + `${money(a.atrasado.montoAnterior, a.atrasado.moneda)} → ${money(a.atrasado.montoNuevo, a.atrasado.moneda)}`,
      chip: 'Sin confirmar', tono: 'err' as const,
    };
  }
  if (a.proximo) {
    return {
      texto: `Próximo ${fecha(a.proximo.vigenteDesde)} · `
        + `${money(a.proximo.montoAnterior, a.proximo.moneda)} → ${money(a.proximo.montoNuevo, a.proximo.moneda)}`,
      chip: ETIQUETA_ESTADO_AJ[a.proximo.estado] ?? a.proximo.estado,
      tono: a.proximo.estado === 'proyectado' ? ('warn' as const) : ('ok' as const),
    };
  }
  if (a.total > 0) {
    return {
      texto: `${plural(a.total, 'aumento aplicado', 'aumentos aplicados')} · ninguno por venir`,
      chip: '', tono: 'neutro' as const,
    };
  }
  return { texto: 'Sin aumentos calculados', chip: '', tono: 'neutro' as const };
});

const resumenGarantes = computed(() => {
  const g = ficha.value?.garantes;
  if (!g) return null;
  if (g.enRegla) {
    return { texto: `${g.aptos} de ${g.total} en regla`, tono: 'ok' as const, detalle: '' };
  }
  return {
    texto: `${g.aptos} de ${g.minimo} en regla`,
    tono: 'warn' as const,
    // El primer pendiente TEXTUAL: «falta consultar el BCRA» dice qué hacer.
    detalle: g.primerPendiente ?? '',
  };
});

const resumenComision = computed(() => {
  const m = ficha.value?.comision;
  if (!m) return null;
  if (!m.armada || !m.total) return { texto: 'Sin armar', tono: 'warn' as const };
  const plata = money(m.total.monto, m.total.moneda);
  if (!m.repartida) return { texto: `${plata} · sin repartir`, tono: 'warn' as const };
  if (m.sinCobrar === 0) return { texto: `${plata} · cobrada`, tono: 'ok' as const };
  return {
    texto: `${plata} · ${plural(m.sinCobrar, 'parte sin cobrar', 'partes sin cobrar')}`,
    tono: 'warn' as const,
  };
});

const resumenDocumentos = computed(() => {
  const d = ficha.value?.documentos;
  if (!d) return null;
  if (d.total === 0) return { texto: 'Sin documentos generados', tono: 'neutro' as const };
  return {
    texto: `${plural(d.total, 'documento', 'documentos')} · último el ${dia(d.ultimoEl)}`,
    chip: d.sinMandar > 0 ? `${d.sinMandar} sin mandar` : '',
    tono: d.sinMandar > 0 ? ('warn' as const) : ('ok' as const),
  };
});

const resumenNotas = computed(() => {
  const n = ficha.value?.notas;
  if (!n) return null;
  if (n.total === 0) return { texto: 'Sin novedades anotadas', tono: 'neutro' as const };
  return {
    texto: `${plural(n.total, 'nota', 'notas')} · última el ${dia(n.ultimaEl)}`,
    chip: n.pendientes > 0 ? `${n.pendientes} pendiente${n.pendientes === 1 ? '' : 's'}` : '',
    tono: n.pendientes > 0 ? ('warn' as const) : ('neutro' as const),
  };
});

/** Cuántos bloques van a salir en el papel con su cabecera y nada más. */
const plegados = computed(() =>
  Object.entries(abiertos.value)
    .filter(([bloqueId, ab]) => !ab && (bloqueId !== 'cuotas' || c.value?.administrado))
    .length,
);

/**
 * La etiqueta del control, armada a mano y no con `plural()`.
 *
 * `plural()` antepone el número a la palabra —«4 bloques cerrados»—, así que
 * `Abrir ${plural(...)}` salía **«Abrir 4 los bloques cerrados»**, que es lo que
 * el botón decía de verdad. El artículo va antes del número en castellano y en
 * singular cambia entero: son dos frases distintas, no una con una `s`.
 */
const etiquetaAbrir = computed(() =>
  plegados.value === 1
    ? 'Abrir el bloque cerrado'
    : `Abrir los ${plegados.value} bloques cerrados`,
);

onMounted(cargar);
</script>

<template>
  <div class="stack ficha">
    <UiSkeleton v-if="cargando" :filas="3" :alto="80" />

    <template v-else-if="c">
      <PageHeader :titulo="c.propiedad.direccion"
        :bajada="`${c.propiedad.etiqueta} · ${fecha(c.fechaInicio)} a ${fecha(c.fechaFin)}`" />

      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <p v-if="aviso" class="aviso-ok" role="status">{{ aviso }}</p>

      <!-- La escapatoria de quien no encuentra un bloque, con el número a la
           vista: «Abrir los 4 cerrados» dice cuántos hay escondidos, «Abrir
           todo» no. Y es también la salida para quien quiere el papel completo
           antes de imprimir. -->
      <div class="control">
        <button v-if="plegados > 0" class="btn secondary sm" type="button"
          @click="bloques.abrirTodos()">
          {{ etiquetaAbrir }}
        </button>
        <button v-else class="btn secondary sm" type="button" @click="bloques.cerrarTodos()">
          Cerrar todo
        </button>
        <button v-if="bloques.hayPreferencia()" class="btn enlace sm" type="button"
          @click="bloques.volverAlDefecto()">
          Volver a como venía
        </button>
      </div>

      <!-- ── 1 · Resumen ─────────────────────────────────────────────────── -->
      <BloqueColapsable
        id="resumen" titulo="Resumen"
        :abierto="abiertos.resumen"
        @update:abierto="bloques.fijar('resumen', $event)"
      >
        <template #resumen>
          <span class="mono fuerte">{{ money(c.montoVigente, c.moneda) }}/mes</span>
          <StatusChip :texto="proximidad(c.fechaFin).texto"
            :tono="proximidad(c.fechaFin).tono === 'neutro' ? 'neutro' : proximidad(c.fechaFin).tono === 'warn' ? 'warn' : 'err'" />
        </template>

        <!--
          Sin «Alquiler vigente» ni «Vence»: los dos están en el `#resumen` de
          arriba, que se ve TAMBIÉN con el bloque abierto. Abrirlo mostraba el
          mismo importe dos veces separado por veinte píxeles, y el mismo plazo
          otras dos.

          Y no era sólo repetir: «ARS 240.000,00» a 20px no entraba en una
          columna de 140px, así que se partía en dos renglones y desalineaba la
          fila entera. El arreglo de la grilla y el de la duplicación eran el
          mismo.
        -->
        <div class="resumen">
          <div><span class="et">Inicial</span><span class="mono">{{ money(c.montoInicial, c.moneda) }}</span></div>
          <div><span class="et">Honorarios</span><span class="mono">{{ c.honorariosPct }}%</span></div>
          <div><span class="et">Locador</span><span>{{ c.locadores.map((l) => l.nombre).join(', ') || '—' }}</span></div>
          <div><span class="et">Inquilino</span><span>{{ c.locatarios.map((l) => l.nombre).join(', ') || '—' }}</span></div>
        </div>
      </BloqueColapsable>

      <!-- ── 2 · Garantes ────────────────────────────────────────────────────
           Van ANTES de los aumentos: es lo que se mira mientras la operación se
           está armando, y lo que decide si el contrato se firma. -->
      <BloqueColapsable
        id="garantes" titulo="Garantes"
        :abierto="abiertos.garantes"
        @update:abierto="bloques.fijar('garantes', $event)"
      >
        <template #resumen>
          <template v-if="resumenGarantes">
            <StatusChip :texto="resumenGarantes.texto" :tono="resumenGarantes.tono" />
            <span v-if="resumenGarantes.detalle" class="apagado">{{ resumenGarantes.detalle }}</span>
          </template>
        </template>

        <!-- La dirección viaja para que el mensaje de WhatsApp pueda nombrar la
             propiedad: «la garantía del alquiler de Arístides Villanueva 345» se
             entiende sin contexto, «la garantía» a secas no. -->
        <GarantesContrato
          :contrato-id="id" :direccion="c.propiedad.direccion" :marco="false"
          @cambio="refrescarFicha"
        />
      </BloqueColapsable>

      <!-- ── Estado del inmueble ──────────────────────────────────────────
           Va pegado a los garantes porque las dos cosas se hacen el mismo día:
           se firma, se entregan las llaves y se recorre la casa con el
           teléfono. -->
      <BloqueColapsable
        id="actas" titulo="Estado del inmueble"
        :abierto="abiertos.actas"
        @update:abierto="bloques.fijar('actas', $event)"
      >
        <template #resumen>
          <span class="apagado">Acta de entrega y de devolución</span>
        </template>

        <ActasContrato :contrato-id="id" @cambio="refrescarFicha" />
      </BloqueColapsable>

      <!-- ── 3 · Comisión ────────────────────────────────────────────────────
           Al lado de los garantes: las dos son «cómo quedó armada esta
           operación», y la comisión se acuerda cuando se firma. -->
      <BloqueColapsable
        id="comision" titulo="Comisión del contrato"
        :abierto="abiertos.comision"
        @update:abierto="bloques.fijar('comision', $event)"
      >
        <template #resumen>
          <StatusChip v-if="resumenComision"
            :texto="resumenComision.texto" :tono="resumenComision.tono" />
        </template>

        <ComisionContrato :contrato-id="id" :marco="false" @cambio="refrescarFicha" />
      </BloqueColapsable>

      <!-- ── 4 · Aumentos ────────────────────────────────────────────────── -->
      <BloqueColapsable
        id="aumentos" titulo="Aumentos"
        :abierto="abiertos.aumentos"
        @update:abierto="bloques.fijar('aumentos', $event)"
      >
        <template #resumen>
          <template v-if="resumenAumentos">
            <span :class="{ apagado: resumenAumentos.tono === 'neutro' }">{{ resumenAumentos.texto }}</span>
            <StatusChip v-if="resumenAumentos.chip"
              :texto="resumenAumentos.chip" :tono="resumenAumentos.tono" />
          </template>
        </template>
        <template #acciones>
          <button class="btn secondary sm" type="button" @click="proyectar">Calcular pendientes</button>
        </template>

        <p v-if="!ajustes.length" class="vacio">
          Sin aumentos calculados. Cada {{ c.periodicidadMeses }} meses corresponde uno por {{ c.indice.toUpperCase() }}.
        </p>
        <template v-else>
          <!-- Truncar no es paginar. Si hay 120 y se ven 100 hay que decirlo:
               callarlo es lo que hacía que veinte cuotas no existieran. -->
          <p v-if="ajustesTotal > ajustes.length" class="truncado">
            Se muestran {{ ajustes.length }} de {{ ajustesTotal }}. Los conteos de la
            cabecera son sobre el total, no sobre lo que se ve acá.
          </p>
          <ul class="ajustes">
            <li v-for="a in ajustes" :key="a.id">
              <div class="aj-cab">
                <span class="mono desde">{{ fecha(a.vigenteDesde) }}</span>
                <StatusChip :texto="ETIQUETA_ESTADO_AJ[a.estado] ?? a.estado"
                  :tono="a.estado === 'proyectado' ? 'warn' : 'ok'" />
                <span class="mono salto">{{ money(a.montoAnterior, a.moneda) }} → <strong>{{ money(a.montoNuevo, a.moneda) }}</strong></span>
                <button v-if="a.estado === 'proyectado'" class="btn sm" type="button" @click="confirmar(a.id)">
                  Confirmar
                </button>
              </div>
              <!-- La memoria de cálculo, siempre visible: un aumento que no se
                   puede explicar al inquilino no sirve. -->
              <pre v-if="a.explicacion" class="mono memoria">{{ a.explicacion }}</pre>
            </li>
          </ul>
        </template>
      </BloqueColapsable>

      <!-- ── 5 · Cuotas ──────────────────────────────────────────────────── -->
      <BloqueColapsable
        v-if="c.administrado"
        id="cuotas" titulo="Cuotas"
        :abierto="abiertos.cuotas"
        @update:abierto="bloques.fijar('cuotas', $event)"
      >
        <template #resumen>
          <StatusChip v-if="resumenCuotas" :texto="resumenCuotas.texto" :tono="resumenCuotas.tono" />
        </template>
        <template #acciones>
          <button class="btn secondary sm" type="button" @click="generarPeriodos">Generar hasta hoy</button>
        </template>

        <p v-if="!periodos.length" class="vacio">Sin cuotas generadas todavía.</p>
        <template v-else>
          <p v-if="periodosTotal > periodos.length" class="truncado">
            Se muestran las {{ periodos.length }} más recientes de {{ periodosTotal }}.
            Los números de la cabecera son sobre el total.
          </p>
          <table>
            <thead>
              <tr><th>Período</th><th>Vence</th><th class="der">Total</th><th class="der">Cobrado</th><th class="der">Saldo</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="p in periodos" :key="p.id">
                <td class="mono">{{ fmtPeriodo(p.periodo) }}</td>
                <td class="mono">{{ fecha(p.venceEl) }}</td>
                <td class="der mono fuerte">{{ money(p.total, p.moneda) }}</td>
                <td class="der mono">{{ money(p.cobrado, p.moneda) }}</td>
                <td class="der mono" :class="{ neg: p.saldo > 0 }">{{ money(p.saldo, p.moneda) }}</td>
                <td>
                  <StatusChip :texto="ETIQUETA_ESTADO_PER[p.estado] ?? p.estado"
                    :tono="p.estado === 'pagado' ? 'ok' : p.estado === 'vencido' ? 'err' : 'warn'" />
                </td>
                <td class="der">
                  <form v-if="cobrando === p.id" class="cobro" @submit.prevent="cobrar(p.id)">
                    <input v-model="montoCobro" inputmode="decimal" :placeholder="String(p.saldo)" autofocus />
                    <button class="btn sm" type="submit">OK</button>
                  </form>
                  <button v-else-if="p.saldo > 0" class="btn secondary sm" type="button"
                          @click="cobrando = p.id; montoCobro = String(p.saldo)">
                    Cobrar
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </BloqueColapsable>

      <p v-else class="card nota-inter">
        Contrato de <strong>intermediación</strong>: no genera cuotas ni liquidaciones. La
        inmobiliaria cobró su comisión una vez y las partes arreglan entre ellas.
      </p>

      <!-- ── 6 · Pre-contrato y avisos ───────────────────────────────────── -->
      <BloqueColapsable
        id="documentos" titulo="Pre-contrato y avisos"
        :abierto="abiertos.documentos"
        @update:abierto="bloques.fijar('documentos', $event)"
      >
        <template #resumen>
          <template v-if="resumenDocumentos">
            <span :class="{ apagado: resumenDocumentos.tono === 'neutro' }">{{ resumenDocumentos.texto }}</span>
            <StatusChip v-if="resumenDocumentos.chip"
              :texto="resumenDocumentos.chip" :tono="resumenDocumentos.tono" />
          </template>
        </template>

        <PanelDocumentos
          :contrato-id="c.id" :etiqueta="c.propiedad.etiqueta" :marco="false"
          :abrir-ultimo="esNuevo"
          @cambio="refrescarFicha"
        />
      </BloqueColapsable>

      <!-- ── 7 · Seguimiento ─────────────────────────────────────────────── -->
      <BloqueColapsable
        id="seguimiento" titulo="Seguimiento"
        :abierto="abiertos.seguimiento"
        @update:abierto="bloques.fijar('seguimiento', $event)"
      >
        <template #resumen>
          <template v-if="resumenNotas">
            <span :class="{ apagado: resumenNotas.tono === 'neutro' }">{{ resumenNotas.texto }}</span>
            <StatusChip v-if="resumenNotas.chip"
              :texto="resumenNotas.chip" :tono="resumenNotas.tono" />
          </template>
        </template>

        <PanelNotas
          entidad-tipo="contrato_alquiler" :entidad-id="c.id" :marco="false"
          @cambio="refrescarFicha"
        />
      </BloqueColapsable>

      <!-- Sólo en papel: un bloque plegado se imprime con su cabecera y su
           resumen, y esta línea dice cuántos salieron así. Sin ella, alguien
           cierra Cuotas, imprime y entrega una hoja sin la cobranza, sin ninguna
           señal de que faltaba algo. La ficha nunca fue el papel legal —el
           pre-contrato tiene ruta propia justamente por esto—. -->
      <p v-if="plegados > 0" class="solo-papel">
        {{ plural(plegados, 'bloque salió', 'bloques salieron') }} plegado{{ plegados === 1 ? '' : 's' }}:
        se imprimió su resumen, no su contenido. Para el papel completo,
        «Abrir los bloques cerrados» antes de imprimir.
      </p>
    </template>
  </div>
</template>

<style scoped>
.control { display: flex; align-items: center; gap: var(--s-md); }

.resumen { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--s-lg); }
/* `align-items: flex-start` para que un chip no se estire a todo el ancho de su
   columna: estirado se lee como un campo de formulario deshabilitado, no como
   una etiqueta. */
.resumen > div { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.et { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-2); }
.grande { font-size: 20px; color: var(--ink); }
/* `--muted` sobre `--surface`: 5,87 en claro y 6,42 en oscuro. Medido, no
   mirado — la trampa de `--muted-2` a 3,01 está en la tabla de CONTINUAR.md. */
.apagado { color: var(--muted); }
.ajustes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-md); }
.ajustes li { padding: var(--s-md); background: var(--surface-2); border-radius: var(--r-md); }
.aj-cab { display: flex; align-items: center; gap: var(--s-md); flex-wrap: wrap; }
.desde { font-size: 12px; color: var(--muted); }
.salto { font-size: 13px; color: var(--ink-2); }
.memoria { margin: var(--s-sm) 0 0; padding: var(--s-sm) var(--s-md); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-sm); font-size: 11px; line-height: 1.7; color: var(--ink-2); white-space: pre-wrap; }
th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); padding-bottom: var(--s-sm); border-bottom: 1px solid var(--line); }
td { padding: var(--s-sm) 0; border-bottom: 1px solid var(--line); color: var(--ink-2); }
.cobro { display: inline-flex; gap: var(--s-xs); }
.cobro input { width: 110px; font: inherit; font-size: 12px; padding: 2px var(--s-sm); border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--surface); color: var(--ink); text-align: right; }
.vacio { margin: 0; color: var(--muted-2); font-size: 13px; }
.truncado { margin: 0; font-size: 12px; color: var(--warning-ink); line-height: 1.6; }
.nota-inter { color: var(--muted); font-size: 13px; }
/* Se llamaba `.ok` a secas y le pegaba a los chips de los bloques.
   El scoped del padre alcanza al elemento RAÍZ del hijo —la trampa ya anotada
   con la paleta ⌘K—, y el raíz de `StatusChip` con tono ok es un
   `span.chip.ok`: le entraba este `.ok[data-v-…]`, que empata en especificidad
   con `.chip.ok` de familia.css y le gana por venir después. Resultado visible
   en la ficha: los chips «Aplicado» de Aumentos salían con el padding y los
   13px de un cartel, y con `--success` en vez de `--success-ink`, o sea
   **4,33:1** sobre `--success-tint` en tema claro (AA pide 4,5 a ese tamaño).
   Es exactamente el caso que `--success-ink` existe para evitar. El nombre
   ahora no puede chocar con ningún tono de chip. */
.aviso-ok { margin: 0; padding: var(--s-sm) var(--s-md); background: var(--success-tint); border: 1px solid var(--success-line); border-radius: var(--r-md); color: var(--success-ink); font-size: 13px; }

/* La línea del pie existe SÓLO en papel. */
.solo-papel { display: none; }

@media print {
  /* El control de abrir/cerrar son botones y el `@media print` global ya
     esconde `.btn`; el contenedor se va entero para no dejar un hueco. */
  .control { display: none; }
  .solo-papel {
    display: block;
    margin: 0;
    font-size: 11px;
    color: #444;
    border-top: 1px solid #ccc;
    padding-top: 6px;
  }
}
</style>
