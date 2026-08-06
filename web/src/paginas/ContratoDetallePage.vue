<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import { useUi } from '../stores/ui';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import PanelNotas from '../componentes/PanelNotas.vue';
import PanelDocumentos from '../componentes/PanelDocumentos.vue';
import { fecha, money, periodo as fmtPeriodo, proximidad, plural } from '../dominio/formato';
import type { Pagina } from '../dominio/pagina';

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

const route = useRoute();
const ui = useUi();
const id = route.params.id as string;

const c = ref<Contrato | null>(null);
const ajustes = ref<Ajuste[]>([]);
const periodos = ref<Periodo[]>([]);
const cargando = ref(true);
const error = ref('');
const aviso = ref('');
const cobrando = ref<string | null>(null);
const montoCobro = ref('');

const ETIQUETA_ESTADO_AJ: Record<string, string> = {
  proyectado: 'Proyectado', confirmado: 'Confirmado', notificado: 'Notificado', aplicado: 'Aplicado',
};
const ETIQUETA_ESTADO_PER: Record<string, string> = {
  pendiente: 'Pendiente', parcial: 'Parcial', pagado: 'Pagado', vencido: 'Vencido', condonado: 'Condonado',
};

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const [ct, aj, pe] = await Promise.all([
      api<Contrato>(`/contratos/${id}`),
      // Las dos vienen paginadas: se piden holgadas porque la ficha las
      // muestra de corrido. Un contrato de diez años son 120 cuotas.
      api<Pagina<Ajuste>>(`/contratos/${id}/ajustes?porPagina=100`),
      api<Pagina<Periodo>>(`/contratos/${id}/periodos?porPagina=100`),
    ]);
    c.value = ct; ajustes.value = aj.items; periodos.value = pe.items;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar el contrato.';
  } finally { cargando.value = false; }
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
onMounted(cargar);
</script>

<template>
  <div class="stack">
    <UiSkeleton v-if="cargando" :filas="3" :alto="80" />

    <template v-else-if="c">
      <PageHeader :titulo="c.propiedad.direccion"
        :bajada="`${c.propiedad.etiqueta} · ${fecha(c.fechaInicio)} a ${fecha(c.fechaFin)}`" />

      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <p v-if="aviso" class="ok" role="status">{{ aviso }}</p>

      <div class="resumen card">
        <div><span class="et">Alquiler vigente</span><span class="mono grande">{{ money(c.montoVigente, c.moneda) }}</span></div>
        <div><span class="et">Inicial</span><span class="mono">{{ money(c.montoInicial, c.moneda) }}</span></div>
        <div><span class="et">Honorarios</span><span class="mono">{{ c.honorariosPct }}%</span></div>
        <div><span class="et">Vence</span>
          <StatusChip :texto="proximidad(c.fechaFin).texto"
            :tono="proximidad(c.fechaFin).tono === 'neutro' ? 'neutro' : proximidad(c.fechaFin).tono === 'warn' ? 'warn' : 'err'" />
        </div>
        <div><span class="et">Locador</span><span>{{ c.locadores.map((l) => l.nombre).join(', ') || '—' }}</span></div>
        <div><span class="et">Inquilino</span><span>{{ c.locatarios.map((l) => l.nombre).join(', ') || '—' }}</span></div>
      </div>

      <section class="card stack">
        <div class="row entre">
          <h2>Aumentos</h2>
          <button class="btn secondary sm" type="button" @click="proyectar">Calcular pendientes</button>
        </div>
        <p v-if="!ajustes.length" class="vacio">
          Sin aumentos calculados. Cada {{ c.periodicidadMeses }} meses corresponde uno por {{ c.indice.toUpperCase() }}.
        </p>
        <ul v-else class="ajustes">
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
      </section>

      <section v-if="c.administrado" class="card stack">
        <div class="row entre">
          <h2>Cuotas</h2>
          <button class="btn secondary sm" type="button" @click="generarPeriodos">Generar hasta hoy</button>
        </div>
        <p v-if="!periodos.length" class="vacio">Sin cuotas generadas todavía.</p>
        <table v-else>
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
      </section>

      <p v-else class="card nota-inter">
        Contrato de <strong>intermediación</strong>: no genera cuotas ni liquidaciones. La
        inmobiliaria cobró su comisión una vez y las partes arreglan entre ellas.
      </p>

      <!-- Va último y siempre visible: el seguimiento es lo que se consulta
           cuando alguien pregunta "¿qué pasó con este contrato?". -->
      <PanelDocumentos :contrato-id="c.id" :etiqueta="c.propiedad.etiqueta" />

      <PanelNotas entidad-tipo="contrato_alquiler" :entidad-id="c.id" />
    </template>
  </div>
</template>

<style scoped>
.resumen { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--s-lg); }
.resumen > div { display: flex; flex-direction: column; gap: 2px; }
.et { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-2); }
.grande { font-size: 20px; color: var(--ink); }
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
.nota-inter { color: var(--muted); font-size: 13px; }
.ok { margin: 0; padding: var(--s-sm) var(--s-md); background: var(--success-tint); border: 1px solid var(--success-line); border-radius: var(--r-md); color: var(--success); font-size: 13px; }
</style>
