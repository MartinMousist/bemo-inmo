<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { money, moneyCorto, numero, periodo as fmtPeriodo, ETIQUETA_ORIGEN } from '../dominio/formato';

/**
 * El tablero.
 *
 * `/inicio` contesta "qué tengo que hacer hoy". Esto contesta la de fin de mes:
 * **"¿cómo viene el negocio?"** — que hasta ahora no contestaba nadie.
 *
 * Sobre los gráficos y la regla anti-slop de DESIGN.md §6: lo que ahí se
 * prohíbe es el gráfico DECORATIVO, y con razón. Nada de lo de acá lo es, y se
 * defiende con el criterio del propio documento:
 *
 * - Una serie de doce meses en 60×16px contesta "¿esto es normal?", que un
 *   número solo no puede contestar. Ocupa menos que la cifra que acompaña.
 * - En las barras del aging y del embudo, **la barra ES el número**: comparar
 *   magnitudes en una columna de dígitos obliga a leer; con barras se ve.
 * - Ningún gráfico lleva dato que no esté también escrito al lado.
 *
 * Y lo que §6 prohíbe sigue prohibido: nada de torta, dona, área con gradiente,
 * gauge ni 3D. Sin librería: todo es polilínea y rectángulo con los tokens.
 * Traer una librería sumaría peso, un tema propio que pelea con el nuestro y un
 * montón de formas que no queremos.
 *
 * ARS y USD **nunca** comparten eje. Cuando un bloque tiene las dos monedas,
 * salen una debajo de la otra.
 */

interface Importe { moneda: string; monto: number }
interface PuntoMes { periodo: string; monto: number | null }
interface ConBase { valor: number | null; base: number | null; delta: number | null }

interface Tablero {
  periodo: string;
  periodoBase: string;
  vePlata: boolean;
  cobranza: {
    tasa: ConBase;
    emitido: Importe[];
    cobrado: Importe[];
    aging: Array<{ tramo: string; cuotas: number; importes: Importe[] }>;
    deudaVencida: Importe[];
    diasPromedioCobro: ConBase;
    serieTasa: PuntoMes[];
  } | null;
  cartera: {
    unidades: number;
    ocupacion: ConBase;
    contratosVigentes: number;
    renovacion: ConBase;
    vacanciaDias: number | null;
    porVencer: { dias30: number; dias60: number; dias90: number; dias180: number };
    serieVigentes: PuntoMes[];
  };
  negocio: {
    honorariosDevengados: Importe[];
    honorariosBase: Importe[];
    comisionesPorCobrar: Importe[];
    porAgente: Array<{ agenteId: string | null; nombre: string; operaciones: number; importes: Importe[] }>;
  } | null;
  embudo: {
    etapas: Array<{ estado: string; total: number }>;
    porOrigen: Array<{ origen: string; total: number; ganadas: number }>;
    motivosPerdida: Array<{ motivo: string; total: number }>;
    primeraRespuestaHoras: number | null;
  };
}

const ETIQUETA_ETAPA: Record<string, string> = {
  nueva: 'Nueva', contactada: 'Contactada', calificada: 'Calificada',
  visita: 'Visita', negociacion: 'Negociación', ganada: 'Ganada', perdida: 'Perdida',
};
const ETIQUETA_MOTIVO: Record<string, string> = {
  precio: 'Precio', se_fue_con_otra: 'Se fue con otra', no_calificaba: 'No calificaba',
  sin_respuesta: 'Sin respuesta', no_consiguio_credito: 'Sin crédito', otro: 'Otro',
};

const ruta = useRoute();
const d = ref<Tablero | null>(null);
const cargando = ref(true);
const error = ref('');
const mes = ref(
  /^\d{4}-\d{2}$/.test(String(ruta.query.periodo ?? ''))
    ? String(ruta.query.periodo)
    : new Date().toISOString().slice(0, 7),
);

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    d.value = await api<Tablero>(`/tablero?periodo=${mes.value}-01`);
  } catch (e) {
    // Igual que en Vencimientos: si falla, los números NO se muestran. Un cero
    // al lado de un error es un número inventado.
    d.value = null;
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar el tablero.';
  } finally {
    cargando.value = false;
  }
}

watch(mes, () => void cargar());
onMounted(cargar);

/** Formatea un porcentaje, o el guion largo cuando no hay dato. */
function pct(v: number | null): string {
  return v === null ? '—' : `${v.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`;
}

/**
 * El color del delta contra el mismo mes del año anterior.
 *
 * ⚠️ **Subir no siempre es bueno.** En la tasa de cobranza y en la ocupación,
 * más es mejor; en los **días promedio de cobro**, más días es peor — cobrar a
 * los 12 días en vez de a los 2 es una cartera que empeoró. Pintar de verde
 * todo lo que sube es el error clásico de los tableros, y en éste sería
 * decirle a alguien "vas bien" justo cuando va mal.
 *
 * `null` y 0 quedan neutros: "no cambió" y "no hay con qué comparar" no son
 * un logro.
 */
function signo(v: number | null, menosEsMejor = false): '' | 'up' | 'down' {
  if (v === null || v === 0) return '';
  const bueno = menosEsMejor ? v < 0 : v > 0;
  return bueno ? 'up' : 'down';
}
function deltaTexto(v: number | null, unidad = 'pp'): string {
  if (v === null) return 'sin base para comparar';
  const s = v > 0 ? '+' : '';
  return `${s}${v.toLocaleString('es-AR', { maximumFractionDigits: 1 })} ${unidad}`;
}

/**
 * Una polilínea de 12 puntos en 112×26. Los `null` cortan la serie en vez de
 * dibujarse en cero: un mes sin dato no es un mes en cero.
 */
function sparkline(serie: PuntoMes[]): { d: string; cx: number; cy: number } | null {
  const vals = serie.map((s) => s.monto);
  const validos = vals.filter((v): v is number => v !== null);
  if (validos.length < 2) return null;

  const min = Math.min(...validos);
  const max = Math.max(...validos);
  const rango = max - min || 1;
  const W = 112, H = 26, P = 3;

  const punto = (v: number, i: number) => ({
    x: P + (i * (W - 2 * P)) / (vals.length - 1),
    y: H - P - ((v - min) / rango) * (H - 2 * P),
  });

  let d = '';
  let ultimoX = 0;
  let ultimoY = 0;
  let hay = false;
  let arrancado = false;
  vals.forEach((v, i) => {
    if (v === null) { arrancado = false; return; }
    const p = punto(v, i);
    d += `${arrancado ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)} `;
    arrancado = true;
    hay = true;
    ultimoX = p.x;
    ultimoY = p.y;
  });

  return hay ? { d: d.trim(), cx: ultimoX, cy: ultimoY } : null;
}

/** El ancho de una barra, en %, contra el máximo de su grupo. */
function ancho(valor: number, maximo: number): string {
  if (!maximo) return '0%';
  return `${Math.max(2, (100 * valor) / maximo)}%`;
}

const agingMax = computed(() => {
  const c = d.value?.cobranza;
  if (!c) return 0;
  // El máximo se calcula sobre UNA moneda —la primera de cada tramo— porque
  // mezclar escalas haría que la barra de USD se viera como un hilo.
  return Math.max(0, ...c.aging.map((a) => a.importes[0]?.monto ?? 0));
});
const embudoMax = computed(() => Math.max(1, ...(d.value?.embudo.etapas.map((e) => e.total) ?? [1])));
const origenMax = computed(() => Math.max(1, ...(d.value?.embudo.porOrigen.map((o) => o.total) ?? [1])));
const agenteMax = computed(() =>
  Math.max(1, ...(d.value?.negocio?.porAgente.map((a) => a.importes[0]?.monto ?? 0) ?? [1])),
);

/**
 * Conversión de una etapa a la siguiente, en %.
 *
 * `perdida` NO lleva conversión: no es el paso siguiente a `ganada`, es la otra
 * salida del embudo. Calcularla daba "Perdida · 200%" —cuatro perdidas sobre
 * dos ganadas— que no es un porcentaje de nada. Un número que no significa nada
 * en una pantalla de indicadores es peor que no ponerlo: alguien lo va a leer.
 */
const conversiones = computed(() => {
  const e = d.value?.embudo.etapas ?? [];
  return e.map((etapa, i) => {
    const previa = i === 0 || etapa.estado === 'perdida' ? null : e[i - 1].total;
    return {
      ...etapa,
      conversion: previa === null || previa === 0 ? null : Math.round((100 * etapa.total) / previa),
    };
  });
});
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Tablero"
      :bajada="cargando || !d ? '' : `Contra ${fmtPeriodo(d.periodoBase)}, el mismo mes del año pasado.`"
    >
      <template #acciones>
        <label class="campo suave">
          <span>Período</span>
          <input v-model="mes" type="month" />
        </label>
      </template>
    </PageHeader>

    <p v-if="error" class="alert con-accion" role="alert">
      <span>{{ error }}</span>
      <button class="btn secondary sm" type="button" @click="cargar()">Reintentar</button>
    </p>

    <UiSkeleton v-if="cargando" :filas="4" :alto="96" />

    <template v-else-if="d">
      <!-- ── Cobranza ──────────────────────────────────────────────────── -->
      <section v-if="d.cobranza" class="bloque">
        <h2>Cobranza de {{ fmtPeriodo(d.periodo) }}</h2>

        <div class="kpis">
          <article class="kpi">
            <span class="et">Tasa de cobranza</span>
            <span class="n mono">{{ pct(d.cobranza.tasa.valor) }}</span>
            <div v-if="d.cobranza.tasa.valor !== null" class="barra" aria-hidden="true">
              <i :style="{ width: `${Math.min(100, d.cobranza.tasa.valor)}%` }" />
            </div>
            <p class="delta">
              <span class="v mono" :class="signo(d.cobranza.tasa.delta)">
                {{ deltaTexto(d.cobranza.tasa.delta) }}
              </span>
              <span v-if="d.cobranza.tasa.base !== null" class="base">
                vs. {{ pct(d.cobranza.tasa.base) }}
              </span>
            </p>
            <svg
              v-if="sparkline(d.cobranza.serieTasa)"
              width="112" height="26" viewBox="0 0 112 26"
              :aria-label="`Tasa de cobranza de los últimos doce meses, de ${pct(d.cobranza.serieTasa[0].monto)} a ${pct(d.cobranza.tasa.valor)}`"
              role="img"
            >
              <path
                :d="sparkline(d.cobranza.serieTasa)!.d" fill="none"
                stroke="var(--accent)" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round"
              />
              <circle
                :cx="sparkline(d.cobranza.serieTasa)!.cx"
                :cy="sparkline(d.cobranza.serieTasa)!.cy"
                r="2.4" fill="var(--accent)"
              />
            </svg>
          </article>

          <article class="kpi">
            <span class="et">Deuda vencida</span>
            <template v-if="d.cobranza.deudaVencida.length">
              <span v-for="i in d.cobranza.deudaVencida" :key="i.moneda" class="n mono peligro">
                {{ moneyCorto(i.monto, i.moneda) }}
              </span>
            </template>
            <span v-else class="n mono vacio">—</span>
            <p class="delta">
              <span class="base">
                {{ d.cobranza.aging.reduce((s, a) => s + a.cuotas, 0) }} cuotas sin saldar
              </span>
            </p>
          </article>

          <article class="kpi">
            <span class="et">Días promedio de cobro</span>
            <span v-if="d.cobranza.diasPromedioCobro.valor !== null" class="n mono">
              {{ numero(d.cobranza.diasPromedioCobro.valor) }}<span class="u"> d</span>
            </span>
            <!-- Honestidad: sin cobros no hay promedio. Un cero diría "se cobra
                 el mismo día", que es lo contrario de lo que pasa. -->
            <span v-else class="n mono vacio">sin datos</span>
            <p class="delta">
              <!-- `menosEsMejor`: tardar más en cobrar es empeorar. -->
              <span class="v mono" :class="signo(d.cobranza.diasPromedioCobro.delta, true)">
                {{ deltaTexto(d.cobranza.diasPromedioCobro.delta, 'd') }}
              </span>
            </p>
          </article>

          <article class="kpi">
            <span class="et">Emitido en el mes</span>
            <template v-if="d.cobranza.emitido.length">
              <span v-for="i in d.cobranza.emitido" :key="i.moneda" class="n mono">
                {{ moneyCorto(i.monto, i.moneda) }}
              </span>
            </template>
            <span v-else class="n mono vacio">—</span>
            <p class="delta">
              <span class="base">
                Cobrado:
                <template v-if="d.cobranza.cobrado.length">
                  <span v-for="(i, ix) in d.cobranza.cobrado" :key="i.moneda">
                    {{ ix ? ' · ' : '' }}{{ moneyCorto(i.monto, i.moneda) }}
                  </span>
                </template>
                <template v-else>nada todavía</template>
              </span>
            </p>
          </article>
        </div>

        <!-- El aging. La barra ES el número: en una columna de dígitos, saber
             cuál tramo pesa más obliga a leer los cuatro. -->
        <div class="card pad-sm">
          <h3>Mora por antigüedad</h3>
          <p class="ayuda">
            El tramo es lo que decide qué se hace: a los 30 días se llama, a los 90
            se intima.
          </p>
          <div class="barras">
            <div v-for="a in d.cobranza.aging" :key="a.tramo" class="fila">
              <span class="lab mono">{{ a.tramo }} d</span>
              <span class="track" aria-hidden="true">
                <i
                  :class="a.tramo === '1-30' ? 'aviso' : 'peligro'"
                  :style="{ width: ancho(a.importes[0]?.monto ?? 0, agingMax) }"
                />
              </span>
              <span class="val mono">
                <template v-if="a.importes.length">
                  <span v-for="(i, ix) in a.importes" :key="i.moneda">
                    {{ ix ? ' · ' : '' }}{{ moneyCorto(i.monto, i.moneda) }}
                  </span>
                </template>
                <template v-else>—</template>
              </span>
              <span class="cuotas">{{ a.cuotas }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Honestidad de producto: en vez de esconder el bloque, se dice por qué
           no está. Es lo mismo que hace el inicio. -->
      <p v-else class="alert info">
        Tu rol no accede a la cobranza ni a los honorarios de la inmobiliaria.
        Lo que sigue —cartera y embudo— sí es tuyo.
      </p>

      <!-- ── Cartera ───────────────────────────────────────────────────── -->
      <section class="bloque">
        <h2>Cartera</h2>
        <div class="kpis">
          <article class="kpi">
            <span class="et">Ocupación</span>
            <span class="n mono">{{ pct(d.cartera.ocupacion.valor) }}</span>
            <div v-if="d.cartera.ocupacion.valor !== null" class="barra" aria-hidden="true">
              <i class="ok" :style="{ width: `${Math.min(100, d.cartera.ocupacion.valor)}%` }" />
            </div>
            <p class="delta">
              <span class="v mono" :class="signo(d.cartera.ocupacion.delta)">
                {{ deltaTexto(d.cartera.ocupacion.delta) }}
              </span>
              <span class="base">
                {{ d.cartera.contratosVigentes }} de {{ d.cartera.unidades }} unidades
              </span>
            </p>
            <svg
              v-if="sparkline(d.cartera.serieVigentes)"
              width="112" height="26" viewBox="0 0 112 26"
              aria-label="Contratos vigentes de los últimos doce meses" role="img"
            >
              <path
                :d="sparkline(d.cartera.serieVigentes)!.d" fill="none"
                stroke="var(--success)" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round"
              />
              <circle
                :cx="sparkline(d.cartera.serieVigentes)!.cx"
                :cy="sparkline(d.cartera.serieVigentes)!.cy"
                r="2.4" fill="var(--success)"
              />
            </svg>
          </article>

          <article class="kpi">
            <span class="et">Renovación</span>
            <span class="n mono">{{ pct(d.cartera.renovacion.valor) }}</span>
            <p class="delta">
              <span class="v mono" :class="signo(d.cartera.renovacion.delta)">
                {{ deltaTexto(d.cartera.renovacion.delta) }}
              </span>
              <span class="base">de los contratos que terminaron</span>
            </p>
          </article>

          <article class="kpi">
            <span class="et">Vacancia</span>
            <span v-if="d.cartera.vacanciaDias !== null" class="n mono">
              {{ numero(d.cartera.vacanciaDias) }}<span class="u"> d</span>
            </span>
            <span v-else class="n mono vacio">sin datos</span>
            <p class="delta"><span class="base">promedio entre un contrato y el siguiente</span></p>
          </article>

          <article class="kpi">
            <span class="et">Vencen pronto</span>
            <span class="n mono">{{ d.cartera.porVencer.dias90 }}</span>
            <p class="delta">
              <span class="base">
                {{ d.cartera.porVencer.dias30 }} a 30 d ·
                {{ d.cartera.porVencer.dias180 }} a 180 d
              </span>
            </p>
          </article>
        </div>
      </section>

      <!-- ── Negocio ───────────────────────────────────────────────────── -->
      <section v-if="d.negocio" class="bloque">
        <h2>El negocio</h2>
        <p class="ayuda">
          Lo único de todo el producto que es plata <b>propia</b> y no de terceros.
        </p>

        <div class="kpis">
          <article class="kpi ancho">
            <span class="et">Honorarios devengados</span>
            <template v-if="d.negocio.honorariosDevengados.length">
              <span v-for="i in d.negocio.honorariosDevengados" :key="i.moneda" class="n mono">
                {{ money(i.monto, i.moneda) }}
              </span>
            </template>
            <span v-else class="n mono vacio">—</span>
            <p class="delta">
              <span class="base">
                {{ fmtPeriodo(d.periodoBase) }}:
                <template v-if="d.negocio.honorariosBase.length">
                  <span v-for="(i, ix) in d.negocio.honorariosBase" :key="i.moneda">
                    {{ ix ? ' · ' : '' }}{{ moneyCorto(i.monto, i.moneda) }}
                  </span>
                </template>
                <template v-else>sin datos</template>
              </span>
            </p>
          </article>

          <article class="kpi ancho">
            <span class="et">Comisiones por cobrar</span>
            <template v-if="d.negocio.comisionesPorCobrar.length">
              <span v-for="i in d.negocio.comisionesPorCobrar" :key="i.moneda" class="n mono">
                {{ money(i.monto, i.moneda) }}
              </span>
            </template>
            <span v-else class="n mono vacio">—</span>
            <p class="delta"><span class="base">devengadas y todavía no cobradas</span></p>
          </article>
        </div>

        <div v-if="d.negocio.porAgente.length" class="card pad-sm">
          <h3>Por asesor · últimos 12 meses</h3>
          <div class="barras">
            <div v-for="a in d.negocio.porAgente" :key="a.agenteId ?? a.nombre" class="fila">
              <span class="lab nombre">{{ a.nombre }}</span>
              <span class="track" aria-hidden="true">
                <i class="acento" :style="{ width: ancho(a.importes[0]?.monto ?? 0, agenteMax) }" />
              </span>
              <span class="val mono">
                <span v-for="(i, ix) in a.importes" :key="i.moneda">
                  {{ ix ? ' · ' : '' }}{{ moneyCorto(i.monto, i.moneda) }}
                </span>
              </span>
              <span class="cuotas">{{ a.operaciones }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- ── Embudo ────────────────────────────────────────────────────── -->
      <section class="bloque">
        <h2>Embudo comercial</h2>
        <div class="dos">
          <div class="card pad-sm">
            <h3>Por etapa</h3>
            <p class="ayuda">El porcentaje es la conversión desde la etapa anterior.</p>
            <div class="barras">
              <div v-for="e in conversiones" :key="e.estado" class="fila">
                <span class="lab nombre">{{ ETIQUETA_ETAPA[e.estado] ?? e.estado }}</span>
                <span class="track" aria-hidden="true">
                  <i
                    :class="e.estado === 'ganada' ? 'ok' : e.estado === 'perdida' ? 'peligro' : 'acento'"
                    :style="{ width: ancho(e.total, embudoMax) }"
                  />
                </span>
                <span class="val mono">{{ e.total }}</span>
                <span class="cuotas mono">{{ e.conversion === null ? '' : `${e.conversion}%` }}</span>
              </div>
            </div>
          </div>

          <div class="card pad-sm">
            <h3>Por origen</h3>
            <p class="ayuda">
              Se guarda desde siempre; el número entre paréntesis es cuántas se ganaron.
            </p>
            <div class="barras">
              <div v-for="o in d.embudo.porOrigen" :key="o.origen" class="fila">
                <span class="lab nombre">{{ ETIQUETA_ORIGEN[o.origen] ?? o.origen }}</span>
                <span class="track" aria-hidden="true">
                  <i class="acento" :style="{ width: ancho(o.total, origenMax) }" />
                </span>
                <span class="val mono">{{ o.total }}</span>
                <span class="cuotas mono">{{ o.ganadas ? `(${o.ganadas})` : '' }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="dos">
          <div class="card pad-sm">
            <h3>Por qué se pierden</h3>
            <p v-if="!d.embudo.motivosPerdida.length" class="ayuda">
              Ninguna oportunidad perdida tiene motivo cargado.
            </p>
            <ul v-else class="motivos">
              <li v-for="m in d.embudo.motivosPerdida" :key="m.motivo">
                <span>{{ ETIQUETA_MOTIVO[m.motivo] ?? m.motivo }}</span>
                <span class="mono">{{ m.total }}</span>
              </li>
            </ul>
          </div>

          <div class="card pad-sm">
            <h3>Primera respuesta</h3>
            <p class="ayuda">
              Del alta de la consulta a la primera nota. Es el indicador que más
              correlaciona con cerrar.
            </p>
            <p class="grande mono">
              <template v-if="d.embudo.primeraRespuestaHoras !== null">
                {{ numero(d.embudo.primeraRespuestaHoras) }}<span class="u"> h</span>
              </template>
              <span v-else class="vacio">sin datos</span>
            </p>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.bloque { display: flex; flex-direction: column; gap: var(--s-md); }
.bloque > h2 { margin: 0; }
.bloque > .ayuda { margin: -6px 0 0; }
.ayuda { font-size: 12px; color: var(--muted); margin: 0 0 var(--s-md); }
h3 { margin: 0 0 2px; }

/* ── Tarjetas de indicador ──────────────────────────────────────────────── */
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: var(--s-md);
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--s-lg);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-1);
}
.kpi.ancho { grid-column: span 2; }
.et {
  font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted);
}
.n {
  font-size: clamp(17px, 4vw, 23px);
  line-height: 1.25;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.n.peligro { color: var(--danger-ink); }
.n.vacio { color: var(--muted-2); font-size: 17px; }
.u { font-size: 13px; color: var(--muted); }

.barra {
  height: 5px; margin-top: 7px;
  background: var(--surface-3); border-radius: 999px; overflow: hidden;
}
.barra i { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
.barra i.ok { background: var(--success); }

.delta {
  margin: 5px 0 0; display: flex; flex-wrap: wrap; gap: var(--s-sm);
  font-size: 12px; align-items: baseline;
}
.delta .v { font-weight: 600; color: var(--muted); }
.delta .v.up { color: var(--success-ink); }
.delta .v.down { color: var(--danger-ink); }
.delta .base { color: var(--muted); }

.kpi svg { margin-top: 8px; display: block; }

/* ── Barras horizontales ────────────────────────────────────────────────── */
.barras { display: flex; flex-direction: column; gap: var(--s-sm); margin-top: var(--s-sm); }
.fila {
  display: grid;
  grid-template-columns: 88px 1fr auto 40px;
  gap: var(--s-md);
  align-items: center;
  font-size: 13px;
}
.lab { color: var(--muted); font-size: 12px; }
.lab.nombre {
  color: var(--ink-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.track { height: 15px; background: var(--surface-3); border-radius: 3px; overflow: hidden; }
.track i { display: block; height: 100%; border-radius: 3px; background: var(--muted-2); }
.track i.acento  { background: var(--accent); }
.track i.ok      { background: var(--success); }
.track i.aviso   { background: var(--warning); }
.track i.peligro { background: var(--danger); }
.val { text-align: right; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cuotas { text-align: right; font-size: 12px; color: var(--muted); }

.dos {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--s-md);
  align-items: start;
}

.motivos { list-style: none; margin: var(--s-sm) 0 0; padding: 0; }
.motivos li {
  display: flex; justify-content: space-between; gap: var(--s-md);
  padding: var(--s-xs) 0; border-bottom: 1px solid var(--line); font-size: 13px;
}
.motivos li:last-child { border-bottom: none; }

.grande { margin: var(--s-sm) 0 0; font-size: 26px; color: var(--ink); font-variant-numeric: tabular-nums; }
.grande .vacio { font-size: 17px; color: var(--muted-2); }

@media (max-width: 640px) {
  .kpi.ancho { grid-column: span 1; }
  .fila { grid-template-columns: 72px 1fr auto; }
  .fila .cuotas { display: none; }
}
</style>
