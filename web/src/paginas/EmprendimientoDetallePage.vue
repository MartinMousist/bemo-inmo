<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { useAuth } from '../stores/auth';
import { fecha, money } from '../dominio/formato';

/**
 * La ficha de un emprendimiento: el plano, los planes y el presupuesto.
 *
 * ── Por qué el plano es una grilla y no una tabla ──
 *
 * Porque la pregunta es espacial: «¿qué me queda en el tercero?». Una tabla
 * ordenada por código contesta otra cosa. La grilla por piso es la imagen que
 * el desarrollador ya tiene en la cabeza, y el color hace el resto sin que
 * nadie lea una columna de estado.
 *
 * ── Por qué la calculadora vive acá y no en una pantalla aparte ──
 *
 * Porque se usa con el cliente al lado, señalando una unidad del plano. Mandarlo
 * a otra pantalla a elegir de nuevo la unidad que acaba de tocar es perder la
 * venta en dos clics.
 */

interface Emprendimiento {
  id: string; nombre: string; direccion: string; etapa: string;
  avancePct: number; avanceEl: string | null;
  entregaEstimada: string | null; entregaOriginal: string | null;
  atrasoMeses: number | null;
  unidades: { total: number; disponibles: number; reservadas: number; vendidas: number };
  planes: number;
}
interface Unidad {
  id: string; codigo: string; piso: string | null; depto: string | null;
  tipologia: string | null; ambientes: number | null; supTotal: number | null;
  coeficiente: number | null; estado: string; precio: number | null; moneda: string | null;
}
interface Piso { piso: string; unidades: Unidad[] }
interface Plan {
  id: string; nombre: string; anticipoPct: number; cuotas: number;
  refuerzos: Array<{ cuota: number; pct: number }>;
  contraEntregaPct: number; indice: string; moneda: string;
  activo: boolean; problemas: string[];
}
interface Linea {
  concepto: string; numero: number | null; vence: string | null;
  monto: number; pct: number; ajustable: boolean;
}
interface Presupuesto {
  unidad: { id: string; codigo: string; supTotal: number | null } | null;
  plan: { id: string; nombre: string };
  presupuesto: {
    lineas: Linea[]; total: number; moneda: string; anticipo: number;
    antesDeEntrega: number; contraEntrega: number; cuotaTipica: number;
    formula: string; advertenciaAjuste: string;
  };
  inversion: {
    precioPorM2: number | null; expuestoAntesDeEntregaPct: number;
    ahorroVsTerminado: number | null; ahorroVsTerminadoPct: number | null;
  };
}

const ETAPA: Record<string, string> = {
  pozo: 'En pozo', en_construccion: 'En construcción',
  terminado: 'Terminado', entregado: 'Entregado',
};
const CONCEPTO: Record<string, string> = {
  anticipo: 'Anticipo', cuota: 'Cuota', refuerzo: 'Refuerzo',
  contra_entrega: 'Contra entrega',
};

const route = useRoute();
const auth = useAuth();
const id = route.params.id as string;

const emp = ref<Emprendimiento | null>(null);
const plano = ref<Piso[]>([]);
const planes = ref<Plan[]>([]);
const cargando = ref(true);
const error = ref('');

const esJefe = () => auth.rol === 'owner' || auth.rol === 'admin';

// ── Calculadora ──
const calc = reactive({
  unidadId: '', planId: '', comparable: '', abierta: false,
});
const resultado = ref<Presupuesto | null>(null);
const calculando = ref(false);

// ── Importación ──
const imp = reactive({ abierta: false, csv: '', trabajando: false });
const previa = ref<{
  simulado: boolean; total: number; aceptadas: number; rechazadas: number;
  sumaCoeficientes: number | null;
  filas: Array<{ linea: number; depto: string | null; tipologia: string | null;
    supTotal: number | null; precio: number | null; problema: string | null }>;
} | null>(null);

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const [e, p, pl] = await Promise.all([
      api<Emprendimiento>(`/emprendimientos/${id}`),
      api<Piso[]>(`/emprendimientos/${id}/plano`),
      api<Plan[]>(`/planes-pago?emprendimientoId=${id}`),
    ]);
    emp.value = e; plano.value = p; planes.value = pl;
    if (!calc.planId && pl.length) calc.planId = pl[0].id;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar.';
  } finally { cargando.value = false; }
}

async function actualizarAvance(pct: number) {
  try {
    emp.value = await api<Emprendimiento>(`/emprendimientos/${id}/avance`, {
      method: 'PATCH', body: JSON.stringify({ pct }),
    });
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo actualizar el avance.';
  }
}

function elegirUnidad(u: Unidad) {
  calc.unidadId = u.id;
  calc.abierta = true;
  void calcular();
}

async function calcular() {
  if (!calc.planId) return;
  calculando.value = true; resultado.value = null;
  try {
    resultado.value = await api<Presupuesto>(`/planes-pago/${calc.planId}/presupuesto`, {
      method: 'POST',
      body: JSON.stringify({
        propiedadId: calc.unidadId || undefined,
        comparableTerminado: calc.comparable ? Number(calc.comparable) : undefined,
      }),
    });
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo calcular.';
  } finally { calculando.value = false; }
}

async function importar(confirmar: boolean) {
  imp.trabajando = true; error.value = '';
  try {
    previa.value = await api(`/emprendimientos/${id}/unidades/importar`, {
      method: 'POST',
      body: JSON.stringify({ csv: imp.csv, confirmar }),
    });
    if (confirmar) { imp.abierta = false; imp.csv = ''; await cargar(); }
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo importar.';
  } finally { imp.trabajando = false; }
}

onMounted(cargar);

const tonoUnidad = (u: Unidad) => {
  if (u.estado === 'cerrada') return 'vendida';
  if (u.estado === 'reservada') return 'reservada';
  if (u.estado === 'disponible') return 'libre';
  return 'sinventa';
};

/** La suma de coeficientes tiene que dar ~100 si están todas las unidades. */
const coeficientesRaros = computed(() => {
  const s = previa.value?.sumaCoeficientes;
  return s !== null && s !== undefined && (s < 95 || s > 105);
});
</script>

<template>
  <div class="stack">
    <UiSkeleton v-if="cargando" :filas="3" :alto="90" />
    <p v-else-if="error && !emp" class="alert" role="alert">{{ error }}</p>

    <template v-else-if="emp">
      <PageHeader :titulo="emp.nombre" :bajada="emp.direccion">
        <template #acciones>
          <StatusChip :texto="ETAPA[emp.etapa] ?? emp.etapa"
            :tono="emp.etapa === 'entregado' ? 'ok' : 'warn'" />
          <RouterLink class="btn secondary sm" to="/emprendimientos">Volver</RouterLink>
        </template>
      </PageHeader>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <!-- Avance de obra -->
      <section class="card stack">
        <div class="fila-avance">
          <div class="stack-min">
            <span class="et">Avance de obra</span>
            <div class="avance">
              <div class="barra"><span :style="{ width: `${emp.avancePct}%` }" /></div>
              <strong class="mono">{{ emp.avancePct }}%</strong>
            </div>
            <span v-if="emp.avanceEl" class="chico">Actualizado el {{ fecha(emp.avanceEl) }}</span>
            <span v-else class="chico">Todavía sin cargar</span>
          </div>

          <div class="stack-min">
            <span class="et">Entrega</span>
            <strong>{{ emp.entregaEstimada ? fecha(emp.entregaEstimada) : 'Sin fecha' }}</strong>
            <!-- La diferencia contra lo prometido es EL dato: se dice sola. -->
            <span v-if="emp.atrasoMeses && emp.atrasoMeses > 0" class="atraso">
              {{ emp.atrasoMeses }} {{ emp.atrasoMeses === 1 ? 'mes' : 'meses' }}
              después de lo prometido ({{ fecha(emp.entregaOriginal!) }})
            </span>
          </div>

          <div v-if="esJefe()" class="stack-min">
            <span class="et">Registrar avance</span>
            <div class="botones-avance">
              <button v-for="p in [25, 50, 75, 100]" :key="p" class="btn secondary sm"
                type="button" @click="actualizarAvance(p)">{{ p }}%</button>
            </div>
          </div>
        </div>
      </section>

      <!-- El plano -->
      <section class="card stack">
        <div class="cab-plano">
          <h2>Plano</h2>
          <div class="leyenda">
            <span class="marca libre" /> Disponible
            <span class="marca reservada" /> Reservada
            <span class="marca vendida" /> Vendida
            <span class="marca sinventa" /> Sin publicar
          </div>
          <button v-if="esJefe()" class="btn secondary sm" type="button"
            @click="imp.abierta = !imp.abierta">
            {{ imp.abierta ? 'Cerrar' : 'Cargar unidades' }}
          </button>
        </div>

        <p v-if="!plano.length" class="nota">
          Todavía no hay unidades. Se cargan de una vez desde una planilla:
          <a href="/v1/emprendimientos/plantilla-unidades.csv">bajá la plantilla</a>,
          completala en Excel y guardala como CSV.
        </p>

        <div v-for="p in plano" :key="p.piso" class="piso">
          <span class="nombre-piso">{{ p.piso === 'Planta baja' ? p.piso : `Piso ${p.piso}` }}</span>
          <div class="unidades">
            <button
              v-for="u in p.unidades"
              :key="u.id"
              type="button"
              class="unidad"
              :class="[tonoUnidad(u), { elegida: calc.unidadId === u.id }]"
              :title="`${u.codigo} · ${u.tipologia ?? ''}`"
              @click="elegirUnidad(u)"
            >
              <strong>{{ u.depto ?? u.codigo }}</strong>
              <span v-if="u.supTotal">{{ u.supTotal }} m²</span>
              <span v-if="u.precio" class="precio mono">
                {{ money(u.precio, u.moneda ?? 'USD') }}
              </span>
            </button>
          </div>
        </div>
      </section>

      <!-- Importar unidades -->
      <section v-if="imp.abierta" class="card stack">
        <h2>Cargar unidades desde una planilla</h2>
        <p class="nota">
          Pegá el contenido del CSV. <strong>Primero se simula</strong>: vas a ver
          exactamente qué se va a crear antes de confirmar nada.
        </p>
        <textarea v-model="imp.csv" rows="6"
          placeholder="piso;depto;tipologia;ambientes;m2;coeficiente;precio" />
        <div class="row">
          <button class="btn secondary" type="button" :disabled="imp.trabajando || !imp.csv"
            @click="importar(false)">
            {{ imp.trabajando ? 'Procesando…' : 'Simular' }}
          </button>
          <button v-if="previa && previa.aceptadas" class="btn" type="button"
            :disabled="imp.trabajando" @click="importar(true)">
            Crear {{ previa.aceptadas }} unidades
          </button>
        </div>

        <template v-if="previa">
          <p class="resumen-imp">
            {{ previa.total }} filas · <b>{{ previa.aceptadas }}</b> se pueden crear
            <template v-if="previa.rechazadas">
              · <b class="mal">{{ previa.rechazadas }}</b> con problemas
            </template>
          </p>
          <!-- Si los coeficientes no dan ~100, falta una unidad o sobra. Es el
               chequeo que un Excel no hace y que se descubre en la escritura. -->
          <p v-if="previa.sumaCoeficientes !== null" class="nota"
            :class="{ ojo: coeficientesRaros }">
            Los coeficientes suman {{ previa.sumaCoeficientes }}%.
            <template v-if="coeficientesRaros">
              Si son todas las unidades del edificio, tendría que dar cerca de 100.
            </template>
          </p>

          <table class="previa">
            <thead>
              <tr><th>Línea</th><th>Unidad</th><th class="der">m²</th><th class="der">Precio</th><th>Estado</th></tr>
            </thead>
            <tbody>
              <tr v-for="f in previa.filas" :key="f.linea" :class="{ mala: f.problema }">
                <td class="mono">{{ f.linea }}</td>
                <td>{{ f.depto ?? '—' }} <span class="tip">{{ f.tipologia }}</span></td>
                <td class="der mono">{{ f.supTotal ?? '—' }}</td>
                <td class="der mono">{{ f.precio ?? '—' }}</td>
                <td>{{ f.problema ?? 'Lista' }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </section>

      <!-- Calculadora -->
      <section class="card stack">
        <h2>Presupuesto para el cliente</h2>

        <p v-if="!planes.length" class="nota">
          No hay planes de pago cargados para este emprendimiento. Sin un plan no
          se puede armar un presupuesto.
        </p>

        <template v-else>
          <div class="fila-calc">
            <label class="campo">
              <span>Plan de pago</span>
              <select v-model="calc.planId" @change="calcular">
                <option v-for="p in planes" :key="p.id" :value="p.id">
                  {{ p.nombre }} — {{ p.anticipoPct }}% + {{ p.cuotas }} cuotas
                  <template v-if="p.indice !== 'ninguno'">({{ p.indice.toUpperCase() }})</template>
                </option>
              </select>
            </label>
            <label class="campo">
              <span>Unidad</span>
              <select v-model="calc.unidadId" @change="calcular">
                <option value="">Elegí una del plano</option>
                <option v-for="p in plano" :key="p.piso" disabled>── {{ p.piso }} ──</option>
                <option v-for="u in plano.flatMap(p => p.unidades)" :key="u.id" :value="u.id">
                  {{ u.depto ?? u.codigo }} · {{ u.supTotal }} m²
                </option>
              </select>
            </label>
            <label class="campo">
              <span>Terminado comparable</span>
              <input v-model="calc.comparable" type="number" placeholder="130000"
                @change="calcular" />
              <small>Opcional: para mostrar cuánto se ahorra comprando en pozo.</small>
            </label>
          </div>

          <p v-if="calculando" class="nota">Calculando…</p>

          <template v-if="resultado">
            <div class="titulares">
              <div>
                <span class="et">Anticipo</span>
                <strong class="mono grande">
                  {{ money(resultado.presupuesto.anticipo, resultado.presupuesto.moneda) }}
                </strong>
              </div>
              <div>
                <span class="et">Cuota típica</span>
                <strong class="mono grande">
                  {{ money(resultado.presupuesto.cuotaTipica, resultado.presupuesto.moneda) }}
                </strong>
              </div>
              <div>
                <span class="et">Contra entrega</span>
                <strong class="mono grande">
                  {{ money(resultado.presupuesto.contraEntrega, resultado.presupuesto.moneda) }}
                </strong>
              </div>
              <div>
                <span class="et">Total</span>
                <strong class="mono grande acento">
                  {{ money(resultado.presupuesto.total, resultado.presupuesto.moneda) }}
                </strong>
              </div>
            </div>

            <div class="inversion">
              <span v-if="resultado.inversion.precioPorM2">
                <b class="mono">{{ money(resultado.inversion.precioPorM2, resultado.presupuesto.moneda) }}</b> por m²
              </span>
              <span>
                <b class="mono">{{ resultado.inversion.expuestoAntesDeEntregaPct }}%</b>
                se paga antes de recibir la unidad
              </span>
              <span v-if="resultado.inversion.ahorroVsTerminado">
                <b class="mono">{{ money(resultado.inversion.ahorroVsTerminado, resultado.presupuesto.moneda) }}</b>
                menos que un terminado ({{ resultado.inversion.ahorroVsTerminadoPct }}%)
              </span>
            </div>

            <!-- La advertencia del ajuste va ANTES de la tabla, no al pie: quien
                 mira los números tiene que saber que son de hoy. -->
            <p v-if="resultado.presupuesto.advertenciaAjuste" class="ajuste">
              {{ resultado.presupuesto.advertenciaAjuste }}
            </p>

            <div class="tabla-wrap">
              <table class="cuotas">
                <thead>
                  <tr>
                    <th>Concepto</th><th>Vence</th>
                    <th class="der">%</th><th class="der">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(l, i) in resultado.presupuesto.lineas" :key="i"
                    :class="{ refuerzo: l.concepto === 'refuerzo' }">
                    <td>
                      {{ CONCEPTO[l.concepto] ?? l.concepto }}
                      <template v-if="l.numero"> {{ l.numero }}</template>
                    </td>
                    <td class="mono chico">
                      {{ l.vence ? fecha(l.vence) : 'Al recibir la unidad' }}
                    </td>
                    <td class="der mono chico">{{ l.pct }}%</td>
                    <td class="der mono">{{ money(l.monto, resultado.presupuesto.moneda) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Todo cálculo lleva su memoria de cálculo. -->
            <p class="formula mono">{{ resultado.presupuesto.formula }}</p>
          </template>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
h2 { margin: 0; font-size: 15px; }
.nota { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.6; max-width: 76ch; }
.nota.ojo { color: var(--warning); }
.et { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-2); }
.chico { font-size: 11px; color: var(--muted); }
.stack-min { display: flex; flex-direction: column; gap: 2px; }

.fila-avance { display: flex; gap: var(--s-2xl); flex-wrap: wrap; }
.avance { display: flex; align-items: center; gap: var(--s-sm); }
.barra { width: 180px; height: 8px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
.barra span { display: block; height: 100%; background: var(--accent); }
.atraso { font-size: 11px; color: var(--warning); max-width: 40ch; line-height: 1.4; }
.botones-avance { display: flex; gap: var(--s-2xs); }

.cab-plano { display: flex; align-items: center; gap: var(--s-md); flex-wrap: wrap; }
.cab-plano h2 { margin-right: auto; }
.leyenda { display: flex; align-items: center; gap: var(--s-xs); font-size: 11px; color: var(--muted); }
.marca { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.marca.libre { background: var(--ok, #2f9e6f); }
.marca.reservada { background: var(--warning, #d99b1e); }
.marca.vendida { background: var(--muted-2); }
.marca.sinventa { background: var(--line-strong); }

.piso { display: flex; gap: var(--s-md); align-items: flex-start; padding: var(--s-xs) 0; }
.piso + .piso { border-top: 1px solid var(--line); }
.nombre-piso { font-size: 12px; color: var(--muted); min-width: 90px; padding-top: 6px; }
.unidades { display: flex; flex-wrap: wrap; gap: var(--s-xs); }
.unidad {
  font: inherit; cursor: pointer; text-align: left;
  display: flex; flex-direction: column; gap: 1px;
  min-width: 92px; padding: var(--s-xs) var(--s-sm);
  border: 1px solid var(--line-strong); border-left-width: 4px;
  border-radius: var(--r-md); background: var(--surface); color: var(--ink);
  font-size: 11px;
}
.unidad strong { font-size: 13px; }
.unidad .precio { color: var(--muted); }
.unidad.libre { border-left-color: var(--ok, #2f9e6f); }
.unidad.reservada { border-left-color: var(--warning, #d99b1e); }
.unidad.vendida { border-left-color: var(--muted-2); opacity: 0.65; }
.unidad.sinventa { border-left-color: var(--line-strong); }
.unidad.elegida { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }

textarea {
  font: inherit; font-family: var(--font-mono); font-size: 12px;
  padding: var(--s-sm); border: 1px solid var(--line-strong);
  border-radius: var(--r-md); background: var(--surface); color: var(--ink); width: 100%;
}
.resumen-imp { margin: 0; font-size: 13px; }
.mal { color: var(--warning); }
.previa { width: 100%; border-collapse: collapse; font-size: 12px; }
.previa th, .previa td { padding: 4px var(--s-xs); border-bottom: 1px solid var(--line); text-align: left; }
.previa tr.mala { color: var(--warning); }
.tip { color: var(--muted-2); font-size: 11px; }

.fila-calc { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--s-md); }
.campo { display: flex; flex-direction: column; gap: var(--s-2xs); }
.campo select, .campo input {
  font: inherit; padding: 8px var(--s-md); border: 1px solid var(--line-strong);
  border-radius: var(--r-md); background: var(--surface); color: var(--ink);
}
.campo small { font-size: 11px; color: var(--muted); }

.titulares { display: flex; gap: var(--s-2xl); flex-wrap: wrap; }
.titulares > div { display: flex; flex-direction: column; }
.grande { font-size: 20px; }
.acento { color: var(--accent-ink); }
.inversion { display: flex; gap: var(--s-lg); flex-wrap: wrap; font-size: 12px; color: var(--muted); }
.ajuste {
  margin: 0; font-size: 12px; line-height: 1.6; padding: var(--s-sm) var(--s-md);
  background: var(--warning-tint, var(--surface-2)); border-radius: var(--r-md); max-width: 80ch;
}
.tabla-wrap { overflow-x: auto; max-height: 420px; }
.cuotas { width: 100%; border-collapse: collapse; font-size: 13px; }
.cuotas th, .cuotas td { padding: 4px var(--s-sm); border-bottom: 1px solid var(--line); text-align: left; }
.cuotas th { font-size: 10px; text-transform: uppercase; color: var(--muted-2); }
.cuotas tr.refuerzo { background: var(--surface-2); }
.der { text-align: right; }
.formula { margin: 0; font-size: 11px; color: var(--muted); }
</style>
