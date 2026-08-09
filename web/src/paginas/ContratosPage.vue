<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError, descargar } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import PageHeader from '../componentes/PageHeader.vue';
import SearchInput from '../componentes/SearchInput.vue';
import SelectAgente from '../componentes/SelectAgente.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiPager from '../componentes/UiPager.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import ThOrden from '../componentes/ThOrden.vue';
import { fecha, money, moneyCorto, periodo as fmtPeriodo, proximidad, plural } from '../dominio/formato';
import { consulta, type Pagina } from '../dominio/pagina';
import { filtrosRecordados } from '../dominio/filtros';
import { hayFiltroDeAgente, paramsDeAgente } from '../dominio/agente';

/**
 * La cartera de alquileres.
 *
 * Antes esta pantalla era una tabla del CONTRATO: fechas, monto, estado. Eso
 * contesta "qué firmé". La pregunta de todos los días es "¿cobré?, ¿tengo que
 * confirmar un aumento?, ¿quién debe?", y para contestarla había que entrar a la
 * ficha de cada contrato de a uno.
 *
 * Ahora la fila trae las cuatro columnas de gestión y las dos acciones que se
 * hacen todo el tiempo —confirmar el aumento y registrar el cobro— sin salir de
 * la lista. Lo que necesita pensar sigue estando en la ficha.
 */

interface Fila {
  id: string;
  propiedad: { id: string; etiqueta: string; direccion: string };
  inquilino: string | null;
  propietario: string | null;
  /** Quién captó la PROPIEDAD. No hay «agente del contrato» en la base. */
  captador: { id: string; nombre: string } | null;
  montoVigente: number;
  moneda: string;
  indice: string;
  indicePorcentaje: number | null;
  periodicidadMeses: number;
  administrado: boolean;
  fechaFin: string;
  diasParaVencer: number;
  estado: string;
  proximoAjuste: {
    id: string; vigenteDesde: string; montoNuevo: number; moneda: string;
    estado: string; vencido: boolean;
  } | null;
  ultimaCuota: {
    id: string; periodo: string; venceEl: string; total: number;
    cobrado: number; saldo: number; moneda: string; estado: string;
  } | null;
  cobranza: {
    estado: 'al_dia' | 'parcial' | 'en_mora' | 'sin_cuotas';
    adeudado: number; cuotasEnMora: number; moraDesde: string | null;
  };
}

const POR_PAGINA = 50;

const ETIQUETA_INDICE: Record<string, string> = {
  ipc: 'IPC', icl: 'ICL', uva: 'UVA', icp: 'Casa Propia',
  porcentaje_fijo: '% fijo', ninguno: 'Sin ajuste',
};
const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Borrador', por_iniciar: 'Por iniciar', vigente: 'Vigente',
  vencido: 'Vencido', rescindido: 'Rescindido', renovado: 'Renovado',
};
const ETIQUETA_COBRANZA: Record<string, string> = {
  al_dia: 'Al día', parcial: 'Parcial', en_mora: 'En mora', sin_cuotas: 'Sin cuotas',
};
const TONO_COBRANZA: Record<string, 'ok' | 'warn' | 'err' | 'neutro'> = {
  al_dia: 'ok', parcial: 'warn', en_mora: 'err', sin_cuotas: 'neutro',
};

const router = useRouter();
const auth = useAuth();
const ui = useUi();

const items = ref<Fila[]>([]);
const total = ref(0);
const paginas = ref(1);
const pagina = ref(1);
const cargando = ref(true);
const error = ref('');

const q = ref('');

/**
 * Los filtros se recuerdan entre visitas. Cada usuario mira dos o tres cosas
 * —«los que están en mora», «los que vencen este trimestre»— y hasta acá las
 * volvía a tipear en cada carga. La búsqueda NO: un texto guardado hace que la
 * pantalla arranque mostrando doce de doscientos contratos sin que se vea por
 * qué.
 */
const { valores: filtros, limpiar: limpiarFiltros } = filtrosRecordados(
  'cartera',
  { cobranza: '', indice: '', venceEn: '', agente: '' },
  { cobranza: Object.keys(ETIQUETA_COBRANZA), indice: Object.keys(ETIQUETA_INDICE) },
);

/** Orden pedido por el usuario. `null` = el del backend, que es por urgencia. */
const orden = ref<string | null>(null);
const dir = ref<'asc' | 'desc'>('asc');

function ordenarPor(campo: string | null, d: 'asc' | 'desc') {
  orden.value = campo;
  dir.value = d;
  pagina.value = 1;
  void cargar();
}

/**
 * Lista o tarjetas.
 *
 * La lista es el default en escritorio —densidad es una virtud en DESIGN.md— y
 * las tarjetas, el default **en pantalla angosta**: ahí la tabla tiene diez
 * columnas y el primer encuentro en un teléfono era un scroll lateral. La vista
 * de tarjetas ya existía y estaba bien resuelta; lo que faltaba era elegirla.
 *
 * Una preferencia explícita gana sobre el ancho: quien eligió lista en el
 * teléfono la quiere en el teléfono.
 */
const CLAVE_MODO = 'bemo_inmo_cartera_modo';
const guardado = localStorage.getItem(CLAVE_MODO) as 'lista' | 'tarjetas' | null;
const angosta = typeof window !== 'undefined'
  && window.matchMedia('(max-width: 640px)').matches;
const modo = ref<'lista' | 'tarjetas'>(guardado ?? (angosta ? 'tarjetas' : 'lista'));
watch(modo, (m) => localStorage.setItem(CLAVE_MODO, m));

const seleccion = ref(new Set<string>());
/** Sólo quien puede tocar plata ve las acciones que la mueven. */
const puedeOperar = computed(() => auth.rol === 'owner' || auth.rol === 'admin');
/** Fila que está mostrando el campo de cobro, y el monto tipeado. */
const cobrando = ref<string | null>(null);
const montoCobro = ref('');
const trabajando = ref(false);
/**
 * Qué filas están esperando al servidor.
 *
 * Por FILA y no un skeleton de pantalla completa: confirmar un aumento tarda
 * medio segundo, y volver toda la cartera a esqueleto por eso hace perder el
 * lugar donde estaba la persona. El resto de la tabla sigue usable.
 */
const ocupadas = ref(new Set<string>());
const ocupada = (id: string) => ocupadas.value.has(id);

async function conFila<T>(id: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (ocupadas.value.has(id)) return undefined;
  ocupadas.value = new Set(ocupadas.value).add(id);
  try {
    return await fn();
  } finally {
    const s = new Set(ocupadas.value);
    s.delete(id);
    ocupadas.value = s;
  }
}

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const r = await api<Pagina<Fila>>(
      `/contratos/cartera?${consulta(
        { pagina: pagina.value, porPagina: POR_PAGINA },
        {
          q: q.value.trim(),
          cobranza: filtros.value.cobranza,
          indice: filtros.value.indice,
          venceEn: filtros.value.venceEn,
          // En alquileres el agente es el CAPTADOR de la propiedad:
          // `contrato_alquiler` no tiene agente propio. Por eso el control se
          // rotula «Captador» y no «Agente».
          ...paramsDeAgente(filtros.value.agente, auth.usuario?.id ?? null),
          orden: orden.value ?? '',
          dir: orden.value ? dir.value : '',
        },
      )}`,
    );
    items.value = r.items;
    total.value = r.total;
    paginas.value = r.paginas;
    // La selección se limpia al cambiar de página o de filtro: dejar marcados
    // contratos que ya no están a la vista hace que una acción en lote toque
    // cosas que el usuario no ve.
    seleccion.value = new Set();
    cobrando.value = null;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la cartera.';
  } finally { cargando.value = false; }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
/**
 * `deep: true` y no es cosmético: **sin esto los filtros no filtraban**.
 *
 * `filtros` es un `ref` que guarda un objeto. Cambiar `filtros.value.cobranza`
 * lo MUTA: la identidad del objeto no cambia, y un `watch` sobre el ref compara
 * identidades. La consecuencia era que elegir «En mora» guardaba la preferencia
 * en `localStorage` —ese watch sí es `deep`— y la lista seguía mostrando los 18
 * contratos. El filtro recién se aplicaba **la próxima vez que se abría la
 * pantalla**, así que parecía que a veces andaba.
 *
 * Apareció al montar el filtro por agente: el chip se prendía, el desplegable
 * cambiaba, el «Limpiar» aparecía —todo eso son `computed`, que sí siguen las
 * mutaciones— y el número del encabezado no se movía.
 */
watch([q, filtros], () => {
  clearTimeout(debounce);
  pagina.value = 1;
  debounce = setTimeout(cargar, 220);
}, { deep: true });
watch(pagina, () => void cargar());

// ── Selección ──────────────────────────────────────────────────────────────

function alternar(id: string) {
  const s = new Set(seleccion.value);
  s.has(id) ? s.delete(id) : s.add(id);
  seleccion.value = s;
}

const todosMarcados = computed(
  () => items.value.length > 0 && seleccion.value.size === items.value.length,
);

function alternarTodos() {
  seleccion.value = todosMarcados.value
    ? new Set()
    : new Set(items.value.map((f) => f.id));
}

// ── Acciones en línea ──────────────────────────────────────────────────────

async function confirmarAjuste(f: Fila) {
  const a = f.proximoAjuste;
  if (!a) return;

  const ok = await ui.confirmar({
    titulo: '¿Confirmar el aumento?',
    detalle:
      `${f.propiedad.etiqueta} · ${f.propiedad.direccion}. Pasa a ` +
      `${money(a.montoNuevo, a.moneda)} desde el ${fecha(a.vigenteDesde)}. ` +
      'Una vez confirmado no se recalcula, ni siquiera si después se corrige el índice.',
    confirmar: 'Confirmar el aumento',
  });
  if (!ok) return;

  await conFila(f.id, async () => {
    try {
      await api(`/ajustes/${a.id}/confirmar`, { method: 'POST' });
      ui.ok('Aumento confirmado', `${f.propiedad.etiqueta} · ${money(a.montoNuevo, a.moneda)}`);
      await cargar();
    } catch (e) {
      ui.error('No se pudo confirmar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
    }
  });
}

function abrirCobro(f: Fila) {
  if (cobrando.value === f.id) { cobrando.value = null; return; }
  cobrando.value = f.id;
  // Precargado con el saldo: el caso normal es que paguen lo que deben, y
  // tipear el monto entero cada vez es donde se cuela un cero de más.
  montoCobro.value = String(f.ultimaCuota?.saldo ?? '');
}

async function registrarCobro(f: Fila) {
  const monto = Number(montoCobro.value);
  if (!f.ultimaCuota || !Number.isFinite(monto) || monto <= 0) return;

  const cuota = f.ultimaCuota;
  await conFila(f.id, async () => {
    try {
      await api('/cobros', {
        method: 'POST',
        body: JSON.stringify({ periodoId: cuota.id, monto }),
      });
      cobrando.value = null;
      ui.ok('Cobro registrado', `${f.propiedad.etiqueta} · ${money(monto, cuota.moneda)}`);
      await cargar();
    } catch (e) {
      ui.error('No se pudo registrar el cobro', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
    }
  });
}

// ── Acciones en lote ───────────────────────────────────────────────────────

interface ResultadoLote {
  total: number;
  exitosos: number;
  resultados: Array<{ contratoId: string; ok: boolean; detalle: string }>;
}

async function enLote(ruta: string, verbo: string) {
  const ids = [...seleccion.value];
  if (!ids.length) return;

  const ok = await ui.confirmar({
    titulo: `¿${verbo} en ${plural(ids.length, 'contrato', 'contratos')}?`,
    detalle: 'Se procesan de a uno. Si alguno falla, los demás siguen igual.',
    confirmar: verbo,
  });
  if (!ok) return;

  trabajando.value = true;
  try {
    const r = await api<ResultadoLote>(ruta, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });

    const fallados = r.resultados.filter((x) => !x.ok);
    if (fallados.length) {
      // El motivo del primero que falló, no un "algunos fallaron": con el
      // motivo se arregla; sin él hay que revisar los 40 a mano.
      ui.error(
        `${r.exitosos} de ${r.total} salieron bien`,
        `${fallados.length} con problema · ${fallados[0].detalle}`,
      );
    } else {
      ui.ok(`${plural(r.exitosos, 'contrato procesado', 'contratos procesados')}`, r.resultados[0]?.detalle);
    }
    await cargar();
  } catch (e) {
    ui.error('No se pudo correr la acción', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally {
    trabajando.value = false;
  }
}

async function exportar() {
  error.value = '';
  try { await descargar('/exportar/contratos.csv'); }
  catch (e) { ui.error('No se pudo exportar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado'); }
}

function irA(id: string) { router.push(`/contratos/${id}`); }

const hayFiltro = computed(
  () => !!(q.value || filtros.value.cobranza || filtros.value.indice || filtros.value.venceEn
           || orden.value)
    || hayFiltroDeAgente(filtros.value.agente),
);

/** Limpiar borra también el orden: si no, «Limpiar» no limpia todo. */
function limpiarTodo() {
  q.value = '';
  orden.value = null;
  dir.value = 'asc';
  limpiarFiltros();
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Cartera de alquileres"
      :bajada="cargando ? '' : plural(total, 'contrato', 'contratos')"
    >
      <template #acciones>
        <div class="modos" role="group" aria-label="Formato de la lista">
          <button type="button" :class="{ activo: modo === 'lista' }" @click="modo = 'lista'">
            Lista
          </button>
          <button type="button" :class="{ activo: modo === 'tarjetas' }" @click="modo = 'tarjetas'">
            Tarjetas
          </button>
        </div>
        <button class="btn secondary" type="button" @click="exportar">Exportar</button>
        <RouterLink class="btn" to="/contratos/nuevo">Nuevo contrato</RouterLink>
      </template>
    </PageHeader>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <!-- ── Filtros ──────────────────────────────────────────────────────── -->
    <div class="filtros">
      <SearchInput v-model="q" placeholder="Dirección, código, inquilino o propietario…" />

      <select v-model="filtros.cobranza" aria-label="Estado de cobranza">
        <option value="">Toda la cobranza</option>
        <option v-for="(t, k) in ETIQUETA_COBRANZA" :key="k" :value="k">{{ t }}</option>
      </select>

      <select v-model="filtros.indice" aria-label="Índice de actualización">
        <option value="">Todos los índices</option>
        <option v-for="(t, k) in ETIQUETA_INDICE" :key="k" :value="k">{{ t }}</option>
      </select>

      <label class="mes">
        <span>Vence en</span>
        <input v-model="filtros.venceEn" type="month" />
      </label>

      <!-- «Captador» y no «Agente»: `contrato_alquiler` no tiene columna de
           agente, así que lo único que la base sabe es quién captó la
           propiedad. Quien colocó el inquilino puede ser otra persona. -->
      <SelectAgente v-model="filtros.agente" etiqueta="Captador" />

      <button
        v-if="hayFiltro"
        class="btn secondary sm"
        type="button"
        @click="limpiarTodo"
      >
        Limpiar
      </button>
    </div>

    <!-- `GET /exportar/contratos.csv` no toma filtros: baja la cartera entera. -->
    <p v-if="hayFiltro" class="aviso-exportar">
      El botón «Exportar» baja la cartera completa, no lo que está filtrado.
    </p>

    <!-- ── Barra de selección ───────────────────────────────────────────── -->
    <div v-if="seleccion.size" class="lote">
      <span class="cuenta">{{ plural(seleccion.size, 'seleccionado', 'seleccionados') }}</span>
      <div class="acciones-lote">
        <button
          class="btn secondary sm"
          type="button"
          :disabled="trabajando || !puedeOperar"
          @click="enLote('/contratos/lote/periodos', 'Generar cuotas')"
        >
          Generar cuotas
        </button>
        <button
          class="btn secondary sm"
          type="button"
          :disabled="trabajando || !puedeOperar"
          @click="enLote('/contratos/lote/ajustes/proyectar', 'Proyectar aumentos')"
        >
          Proyectar aumentos
        </button>
        <button class="btn secondary sm" type="button" @click="seleccion = new Set()">
          Deseleccionar
        </button>
      </div>
      <p v-if="!puedeOperar" class="nota-rol">
        Tu rol no puede generar cuotas ni proyectar aumentos.
      </p>
    </div>

    <UiSkeleton v-if="cargando" :filas="5" />

    <UiEmpty
      v-else-if="!items.length && hayFiltro"
      titulo="Ningún contrato coincide"
      detalle="Probá con otro texto o sacá alguno de los filtros."
    />
    <UiEmpty
      v-else-if="!items.length"
      titulo="Todavía no hay contratos"
      detalle="Cargá el primero y el sistema se ocupa de los aumentos, los vencimientos y la liquidación al propietario."
    >
      <RouterLink class="btn" to="/contratos/nuevo">Cargar el primero</RouterLink>
    </UiEmpty>

    <!-- ── Lista ────────────────────────────────────────────────────────── -->
    <div v-else-if="modo === 'lista'" class="card sin-padding">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="marca">
                <input
                  type="checkbox"
                  :checked="todosMarcados"
                  aria-label="Seleccionar todos"
                  @change="alternarTodos"
                />
              </th>
              <ThOrden campo="propiedad" :actual="orden" :dir="dir" @ordenar="ordenarPor">
                Propiedad
              </ThOrden>
              <ThOrden campo="inquilino" :actual="orden" :dir="dir" @ordenar="ordenarPor">
                Inquilino
              </ThOrden>
              <ThOrden campo="alquiler" num :actual="orden" :dir="dir" @ordenar="ordenarPor">
                Alquiler
              </ThOrden>
              <ThOrden campo="aumento" :actual="orden" :dir="dir" @ordenar="ordenarPor">
                Próximo aumento
              </ThOrden>
              <th>Última cuota</th>
              <ThOrden campo="saldo" num :actual="orden" :dir="dir" @ordenar="ordenarPor">
                Saldo
              </ThOrden>
              <th>Cobranza</th>
              <ThOrden campo="vence" :actual="orden" :dir="dir" @ordenar="ordenarPor">
                Vence
              </ThOrden>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="f in items" :key="f.id">
              <!--
                El foco va en la FILA, no en cada celda: con `tabindex` por celda
                habría que tabular nueve veces para pasar a la fila siguiente.
                Las celdas interactivas (la casilla, confirmar, cobrar) frenan
                la propagación, así que Enter sobre la fila lleva a la ficha y
                los controles siguen funcionando por separado.
              -->
              <tr
                :class="{
                  marcada: seleccion.has(f.id),
                  ocupada: ocupada(f.id),
                  urge: f.proximoAjuste?.estado === 'proyectado' && f.proximoAjuste.vencido,
                }"
                :aria-busy="ocupada(f.id)"
                tabindex="0"
                :aria-label="`${f.propiedad.etiqueta} · ${f.propiedad.direccion}`"
                @keydown.enter="irA(f.id)"
              >
                <td class="marca" @click.stop>
                  <input
                    type="checkbox"
                    :checked="seleccion.has(f.id)"
                    :aria-label="`Seleccionar ${f.propiedad.etiqueta}`"
                    @change="alternar(f.id)"
                  />
                </td>

                <td class="clicable" @click="irA(f.id)">
                  <span class="mono cod">{{ f.propiedad.etiqueta }}</span>
                  <span class="dir">{{ f.propiedad.direccion }}</span>
                  <!-- Va acá abajo y no en una columna propia: la tabla ya tiene
                       diez. Y dice «captó» porque eso es lo que el dato afirma:
                       quien colocó el inquilino puede ser otra persona. -->
                  <span v-if="f.captador" class="captador">captó {{ f.captador.nombre }}</span>
                </td>

                <td class="clicable" @click="irA(f.id)">
                  {{ f.inquilino ?? '—' }}
                  <span v-if="!f.administrado" class="inter">sólo intermediación</span>
                </td>

                <td class="der mono fuerte clicable" @click="irA(f.id)">
                  {{ money(f.montoVigente, f.moneda) }}
                  <span class="cada">
                    {{ ETIQUETA_INDICE[f.indice] ?? f.indice
                    }}<template v-if="f.indice !== 'ninguno'"> c/{{ f.periodicidadMeses }}m</template>
                  </span>
                </td>

                <!-- Próximo aumento, con la acción de confirmarlo acá mismo. -->
                <td>
                  <template v-if="f.proximoAjuste">
                    <span class="mono monto-nuevo">
                      {{ moneyCorto(f.proximoAjuste.montoNuevo, f.proximoAjuste.moneda) }}
                    </span>
                    <span class="cuando mono">{{ fecha(f.proximoAjuste.vigenteDesde) }}</span>
                    <button
                      v-if="f.proximoAjuste.estado === 'proyectado' && puedeOperar"
                      class="btn sm en-linea"
                      type="button"
                      :disabled="ocupada(f.id)"
                      @click.stop="confirmarAjuste(f)"
                    >
                      {{ ocupada(f.id) ? 'Confirmando…' : 'Confirmar' }}
                    </button>
                    <StatusChip
                      v-else-if="f.proximoAjuste.estado !== 'proyectado'"
                      texto="Confirmado"
                      tono="ok"
                    />
                  </template>
                  <span v-else class="vacio">—</span>
                </td>

                <!-- Última cuota, con la acción de cobrarla acá mismo. -->
                <td>
                  <template v-if="f.ultimaCuota">
                    <span class="mono">{{ fmtPeriodo(f.ultimaCuota.periodo) }}</span>
                    <span class="cuando mono">vence {{ fecha(f.ultimaCuota.venceEl) }}</span>

                    <div v-if="cobrando === f.id" class="cobro" @click.stop>
                      <input
                        v-model="montoCobro"
                        class="mono"
                        inputmode="decimal"
                        :aria-label="`Monto a cobrar de ${f.propiedad.etiqueta}`"
                        @keydown.enter.prevent="registrarCobro(f)"
                        @keydown.esc="cobrando = null"
                      />
                      <button
                        class="btn sm"
                        type="button"
                        :disabled="ocupada(f.id)"
                        @click="registrarCobro(f)"
                      >
                        {{ ocupada(f.id) ? 'Cobrando…' : 'Cobrar' }}
                      </button>
                    </div>
                    <button
                      v-else-if="f.ultimaCuota.saldo > 0 && puedeOperar"
                      class="btn sm en-linea secondary"
                      type="button"
                      @click.stop="abrirCobro(f)"
                    >
                      Registrar cobro
                    </button>
                  </template>
                  <span v-else class="vacio">sin generar</span>
                </td>

                <td class="der mono clicable" :class="{ debe: f.cobranza.adeudado > 0 }"
                    @click="irA(f.id)">
                  {{ f.cobranza.adeudado > 0 ? money(f.cobranza.adeudado, f.moneda) : '—' }}
                </td>

                <td class="clicable" @click="irA(f.id)">
                  <StatusChip
                    :texto="ETIQUETA_COBRANZA[f.cobranza.estado]"
                    :tono="TONO_COBRANZA[f.cobranza.estado]"
                  />
                  <span v-if="f.cobranza.cuotasEnMora > 1" class="cuando">
                    {{ f.cobranza.cuotasEnMora }} cuotas
                  </span>
                </td>

                <td class="clicable" @click="irA(f.id)">
                  <StatusChip
                    :texto="proximidad(f.fechaFin).texto"
                    :tono="proximidad(f.fechaFin).tono === 'neutro' ? 'neutro'
                      : proximidad(f.fechaFin).tono === 'warn' ? 'warn' : 'err'"
                  />
                </td>

                <td class="clicable" @click="irA(f.id)">
                  <StatusChip
                    :texto="ETIQUETA_ESTADO[f.estado] ?? f.estado"
                    :tono="f.estado === 'vigente' ? 'ok' : 'neutro'"
                  />
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Tarjetas ─────────────────────────────────────────────────────── -->
    <div v-else class="tarjetas">
      <article
        v-for="f in items"
        :key="f.id"
        class="card tarjeta"
        :class="{
          marcada: seleccion.has(f.id),
          urge: f.proximoAjuste?.estado === 'proyectado' && f.proximoAjuste.vencido,
        }"
      >
        <header>
          <input
            type="checkbox"
            :checked="seleccion.has(f.id)"
            :aria-label="`Seleccionar ${f.propiedad.etiqueta}`"
            @change="alternar(f.id)"
          />
          <button class="titulo" type="button" @click="irA(f.id)">
            <span class="mono cod">{{ f.propiedad.etiqueta }}</span>
            <span class="dir">{{ f.propiedad.direccion }}</span>
          </button>
          <StatusChip
            :texto="ETIQUETA_COBRANZA[f.cobranza.estado]"
            :tono="TONO_COBRANZA[f.cobranza.estado]"
          />
        </header>

        <dl>
          <div>
            <dt>Inquilino</dt>
            <dd>{{ f.inquilino ?? '—' }}</dd>
          </div>
          <div>
            <dt>Alquiler</dt>
            <dd class="mono">{{ money(f.montoVigente, f.moneda) }}</dd>
          </div>
          <div>
            <dt>Saldo</dt>
            <dd class="mono" :class="{ debe: f.cobranza.adeudado > 0 }">
              {{ f.cobranza.adeudado > 0 ? money(f.cobranza.adeudado, f.moneda) : '—' }}
            </dd>
          </div>
          <div>
            <dt>Vence</dt>
            <dd class="mono">{{ fecha(f.fechaFin) }}</dd>
          </div>
        </dl>

        <footer v-if="puedeOperar && (f.proximoAjuste?.estado === 'proyectado' || (f.ultimaCuota?.saldo ?? 0) > 0)">
          <button
            v-if="f.proximoAjuste?.estado === 'proyectado'"
            class="btn sm"
            type="button"
            @click="confirmarAjuste(f)"
          >
            Confirmar {{ moneyCorto(f.proximoAjuste.montoNuevo, f.proximoAjuste.moneda) }}
          </button>

          <div v-if="cobrando === f.id" class="cobro">
            <input
              v-model="montoCobro"
              class="mono"
              inputmode="decimal"
              :aria-label="`Monto a cobrar de ${f.propiedad.etiqueta}`"
              @keydown.enter.prevent="registrarCobro(f)"
              @keydown.esc="cobrando = null"
            />
            <button class="btn sm" type="button" @click="registrarCobro(f)">Cobrar</button>
          </div>
          <button
            v-else-if="(f.ultimaCuota?.saldo ?? 0) > 0"
            class="btn sm secondary"
            type="button"
            @click="abrirCobro(f)"
          >
            Registrar cobro
          </button>
        </footer>
      </article>
    </div>

    <UiPager
      v-if="!cargando"
      v-model:pagina="pagina"
      :paginas="paginas"
      :total="total"
      :por-pagina="POR_PAGINA"
      sustantivo="contratos"
    />
  </div>
</template>

<style scoped>
/* ── Filtros ───────────────────────────────────────────────────────────── */
.filtros { display: flex; gap: var(--s-md); flex-wrap: wrap; align-items: center; }
.filtros select,
.filtros input[type='month'] {
  font: inherit; font-size: 13px;
  padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
}
.mes { display: inline-flex; align-items: center; gap: var(--s-xs); font-size: 12px; color: var(--muted); }

.modos {
  display: inline-flex;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--surface);
}
.modos button {
  font: inherit; font-size: 13px;
  padding: var(--s-sm) var(--s-md);
  border: none; border-right: 1px solid var(--line);
  background: transparent; color: var(--muted); cursor: pointer;
}
.modos button:last-child { border-right: none; }
/* `--accent-ink` y no `--accent`: sobre `--accent-tint` el color base da 4,25 a
   13px, que es el número exacto que `tokens.css` cita como motivo de la
   variante. Tercera copia local que se había quedado con el color base —las
   otras dos eran el avatar del menú y el wordmark— y las tres se veían bien. */
.modos button.activo { background: var(--accent-tint); color: var(--accent-ink); font-weight: 500; }

/* ── Barra de lote ─────────────────────────────────────────────────────── */
.lote {
  display: flex;
  align-items: center;
  gap: var(--s-lg);
  flex-wrap: wrap;
  padding: var(--s-md) var(--s-lg);
  background: var(--accent-tint);
  border: 1px solid var(--accent-line);
  border-radius: var(--r-md);
}
.lote .cuenta { font-size: 13px; font-weight: 500; color: var(--accent); }
.acciones-lote { display: flex; gap: var(--s-sm); flex-wrap: wrap; }
.nota-rol { margin: 0; width: 100%; font-size: 12px; color: var(--muted); }

/* ── Tabla ─────────────────────────────────────────────────────────────── */
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  /* Con diez columnas de gestión, dejarla encoger parte "Arístides Villanueva
     345" en tres renglones y arruina la densidad, que es el punto de la vista
     de lista. Antes de eso, la tabla scrollea dentro de su contenedor. */
  min-width: 1080px;
}
td {
  padding: var(--s-md) var(--s-lg);
  border-bottom: 1px solid var(--line);
  color: var(--ink-2);
  vertical-align: top;
}
tbody tr.marcada { background: var(--accent-tint); }
/* El `box-shadow` global de :focus-visible no se ve sobre un `<tr>`: las celdas
   lo tapan. Se marca con el fondo y una barra al costado, que sí se ven. */
/* La fila que espera al servidor se atenúa y no acepta clics. El resto de la
   tabla sigue usable: es la diferencia con un skeleton de pantalla completa. */
tbody tr.ocupada { opacity: .55; pointer-events: none; }
tbody tr:focus-visible {
  outline: none;
  background: var(--surface-2);
  box-shadow: inset 3px 0 0 var(--accent);
}
.marca { width: 1%; padding-right: 0; }
.marca input { accent-color: var(--accent); cursor: pointer; }

.dir { color: var(--ink); }
.cada { display: block; margin-top: 2px; font-size: 11px; color: var(--muted-2); font-family: var(--font-ui); }
.inter { display: block; margin-top: 2px; font-size: 10px; color: var(--muted-2); }
.captador { display: block; margin-top: 2px; font-size: 10px; color: var(--muted-2); }
.aviso-exportar { margin: 0; font-size: 12px; color: var(--muted); }
.cuando { display: block; margin-top: 2px; font-size: 11px; color: var(--muted-2); }
.vacio { color: var(--muted-2); }
.monto-nuevo { color: var(--ink); }
.debe { color: var(--danger); }

/* ── Acciones en línea ─────────────────────────────────────────────────── */
.en-linea { margin-top: var(--s-xs); }

/*
  El aumento cuya vigencia ya pasó pide atención, y antes la pedía pintando el
  botón de `--danger` sólido. Dos problemas con eso, y el segundo es el grave:

  1. Blanco sobre `--danger` daba 3,13:1 en oscuro — AA fallado a 13px.
  2. En todo el resto del producto el rojo sólido significa **destructivo**:
     borrar, rescindir. Confirmar un aumento no destruye nada. Que la pantalla
     más usada le dé al rojo un segundo significado rompe el código de colores
     que el usuario aprende en las otras treinta.

  La urgencia va donde corresponde —la FILA— con la barra que ya se usa para
  marcar estado. El botón se queda primario: la acción es la misma, urgente o
  no. Lo que cambia es cuánto grita la fila.
*/
tr.urge td:first-child { box-shadow: inset 3px 0 0 var(--danger); }
.tarjeta.urge { border-left: 3px solid var(--danger); }
.urge .cuando { color: var(--danger-ink); font-weight: 500; }

.cobro { display: flex; gap: var(--s-xs); margin-top: var(--s-xs); }
.cobro input {
  font: inherit; font-size: 12px;
  width: 11ch;
  padding: 4px var(--s-sm);
  border: 1px solid var(--accent);
  border-radius: var(--r-sm);
  background: var(--surface);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

/* ── Tarjetas ──────────────────────────────────────────────────────────── */
.tarjetas {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--s-lg);
}
.tarjeta { display: flex; flex-direction: column; gap: var(--s-md); }
.tarjeta.marcada { border-color: var(--accent-line); background: var(--accent-tint); }
.tarjeta header { display: flex; align-items: flex-start; gap: var(--s-sm); }
.tarjeta header input { accent-color: var(--accent); cursor: pointer; margin-top: 2px; }
.tarjeta .titulo {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 1px;
  border: none; background: transparent; padding: 0;
  font: inherit; text-align: left; cursor: pointer; color: inherit;
}
.tarjeta dl {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--s-sm) var(--s-md);
}
.tarjeta dt {
  font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted);
}
.tarjeta dd { margin: 0; font-size: 13px; color: var(--ink-2); }
.tarjeta footer { display: flex; gap: var(--s-sm); flex-wrap: wrap; }

@media (max-width: 720px) {
  .filtros > :first-child { min-width: 100%; }
}
</style>
