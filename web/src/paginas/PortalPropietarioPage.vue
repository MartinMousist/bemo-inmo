<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import BemoLogo from '../componentes/BemoLogo.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha, money, periodo as fmtPeriodo } from '../dominio/formato';

/**
 * Lo que ve el propietario.
 *
 * Es la única pantalla del sistema para alguien de afuera, y eso define todo:
 *
 * - **Sin sesión y sin menú.** El dueño no entra al sistema; abre un enlace.
 * - **Sin nada accionable.** No hay un solo botón que escriba algo.
 * - **Se imprime.** Es lo primero que va a hacer un contador con esto, así que
 *   los estilos de impresión no son un extra.
 *
 * El acceso se resuelve contra el backend con el token de la URL; acá no se
 * guarda nada ni se pide sesión.
 */

interface Cuota {
  periodo: string; venceEl: string; total: number; cobrado: number;
  saldo: number; moneda: string; estado: string;
}
interface Vista {
  inmobiliaria: string;
  propietario: string;
  generadoEl: string;
  propiedades: Array<{
    etiqueta: string; direccion: string; porcentaje: number | null;
    contrato: {
      inquilino: string | null; desde: string; hasta: string;
      montoVigente: number; moneda: string; estado: string;
      proximoAumento: { vigenteDesde: string; monto: number } | null;
    } | null;
    cuotas: Cuota[];
  }>;
  liquidaciones: Array<{
    periodo: string; totalBruto: number; totalHonorarios: number;
    totalGastos: number; totalNeto: number; moneda: string; estado: string;
    lineas: Array<{ concepto: string; signo: 1 | -1; monto: number }>;
  }>;
}

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/v1';

const route = useRoute();
const d = ref<Vista | null>(null);
const cargando = ref(true);
const error = ref('');

function tonoCuota(c: Cuota): 'ok' | 'warn' | 'err' {
  if (c.saldo <= 0) return 'ok';
  return c.venceEl < new Date().toISOString().slice(0, 10) ? 'err' : 'warn';
}
function textoCuota(c: Cuota): string {
  if (c.saldo <= 0) return 'Cobrada';
  if (c.cobrado > 0) return 'Cobrada en parte';
  return c.venceEl < new Date().toISOString().slice(0, 10) ? 'Impaga' : 'Por vencer';
}

onMounted(async () => {
  try {
    // `fetch` directo y no el cliente de la app: éste NO manda token ni
    // reintenta con refresh. Quien abre esto no tiene sesión, y hacerlo pasar
    // por el flujo de renovación lo mandaría al login.
    const res = await fetch(`${BASE}/propietario/${route.params.token}`);
    if (!res.ok) {
      const p = await res.json().catch(() => null);
      error.value = p?.detail ?? 'No se pudo abrir el enlace.';
      return;
    }
    d.value = await res.json();
  } catch {
    error.value = 'No se pudo conectar. Probá de nuevo en un momento.';
  } finally {
    cargando.value = false;
  }
});
</script>

<template>
  <div class="portal">
    <header class="cab">
      <BemoLogo :tam="28" con-nombre />
      <span v-if="d" class="quien">{{ d.inmobiliaria }}</span>
    </header>

    <main class="contenido">
      <UiSkeleton v-if="cargando" :filas="4" :alto="72" />

      <div v-else-if="error" class="card aviso">
        <h1>No se pudo abrir</h1>
        <p>{{ error }}</p>
      </div>

      <template v-else-if="d">
        <div class="titulo">
          <h1>{{ d.propietario }}</h1>
          <p class="bajada">
            Estado de tus propiedades y liquidaciones al {{ fecha(d.generadoEl.slice(0, 10)) }}.
            <!-- Honestidad: esto es una foto, no un canal de reclamos. -->
            Ante cualquier duda, hablá con {{ d.inmobiliaria }}.
          </p>
        </div>

        <!-- ── Propiedades ──────────────────────────────────────────────── -->
        <section v-for="p in d.propiedades" :key="p.etiqueta" class="card prop">
          <header>
            <div>
              <span class="mono cod">{{ p.etiqueta }}</span>
              <h2 class="text-lg">{{ p.direccion }}</h2>
            </div>
            <span v-if="p.porcentaje !== null && p.porcentaje < 100" class="pct mono">
              tu parte: {{ p.porcentaje }}%
            </span>
          </header>

          <dl v-if="p.contrato" class="datos">
            <div><dt>Inquilino</dt><dd>{{ p.contrato.inquilino ?? '—' }}</dd></div>
            <div>
              <dt>Alquiler</dt>
              <dd class="mono">{{ money(p.contrato.montoVigente, p.contrato.moneda) }}</dd>
            </div>
            <div><dt>Contrato hasta</dt><dd class="mono">{{ fecha(p.contrato.hasta) }}</dd></div>
            <div v-if="p.contrato.proximoAumento">
              <dt>Próximo aumento</dt>
              <dd class="mono">
                {{ money(p.contrato.proximoAumento.monto, p.contrato.moneda) }}
                <span class="desde">desde {{ fecha(p.contrato.proximoAumento.vigenteDesde) }}</span>
              </dd>
            </div>
          </dl>

          <p v-else class="sin-contrato">
            Sin contrato vigente. Cuando se alquile, vas a ver acá el estado de cobranza.
          </p>

          <div v-if="p.cuotas.length" class="cuotas">
            <h3>Últimos meses</h3>
            <ul>
              <li v-for="c in p.cuotas" :key="c.periodo">
                <span class="mono mes">{{ fmtPeriodo(c.periodo) }}</span>
                <span class="mono monto">{{ money(c.total, c.moneda) }}</span>
                <StatusChip :texto="textoCuota(c)" :tono="tonoCuota(c)" />
                <span v-if="c.saldo > 0 && c.cobrado > 0" class="mono saldo">
                  falta {{ money(c.saldo, c.moneda) }}
                </span>
                <span v-else class="saldo" />
              </li>
            </ul>
          </div>
        </section>

        <!-- ── Liquidaciones ────────────────────────────────────────────── -->
        <section class="card">
          <h2 class="text-lg">Tus liquidaciones</h2>
          <p class="nota">
            Se listan las cerradas. Se liquida lo <strong>cobrado</strong>, no lo
            facturado: un mes que el inquilino no pagó no aparece acá.
          </p>

          <p v-if="!d.liquidaciones.length" class="sin-contrato">
            Todavía no hay liquidaciones cerradas.
          </p>

          <article v-for="l in d.liquidaciones" v-else :key="l.periodo + l.moneda" class="liq">
            <header>
              <span class="mono mes">{{ fmtPeriodo(l.periodo) }}</span>
              <span class="mono neto">{{ money(l.totalNeto, l.moneda) }}</span>
              <StatusChip
                :texto="l.estado === 'pagada' ? 'Transferida' : 'Cerrada'"
                :tono="l.estado === 'pagada' ? 'ok' : 'neutro'"
              />
            </header>
            <!-- El detalle abierto, no escondido detrás de un clic: es
                 exactamente lo que el propietario vino a ver. -->
            <table>
              <tbody>
                <tr v-for="(li, i) in l.lineas" :key="i">
                  <td>{{ li.concepto }}</td>
                  <td class="der mono" :class="{ neg: li.signo === -1 }">
                    {{ li.signo === -1 ? '−' : '' }} {{ money(li.monto, l.moneda) }}
                  </td>
                </tr>
                <tr class="total">
                  <td>Neto</td>
                  <td class="der mono">{{ money(l.totalNeto, l.moneda) }}</td>
                </tr>
              </tbody>
            </table>
          </article>
        </section>
      </template>
    </main>

    <footer class="pie">
      <p>Bemo INMO · Este enlace es personal. No lo compartas.</p>
    </footer>
  </div>
</template>

<style scoped>
.portal { background: var(--bg); min-height: 100vh; display: flex; flex-direction: column; }

.cab {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--s-lg);
  padding: var(--s-lg) var(--s-xl);
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}
.cab .quien { font-size: 13px; color: var(--muted); }

.contenido {
  flex: 1;
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: var(--s-2xl) var(--s-xl);
  display: flex;
  flex-direction: column;
  gap: var(--s-xl);
}

.titulo h1 { font-size: 26px; }
.bajada { margin: var(--s-sm) 0 0; color: var(--muted); font-size: 14px; line-height: 1.6; max-width: 62ch; }

.prop > header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s-md); }
h2 { margin: 2px 0 0; }
h3 { font-size: 13px; margin: 0 0 var(--s-sm); color: var(--muted); font-family: var(--font-ui); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.pct { font-size: 12px; color: var(--accent); white-space: nowrap; }

.datos { margin: var(--s-lg) 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--s-md); }
.datos dt { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.datos dd { margin: 2px 0 0; font-size: 14px; color: var(--ink); }
.desde { display: block; font-size: 11px; color: var(--muted); font-family: var(--font-ui); }

.sin-contrato { margin: var(--s-md) 0 0; font-size: 13px; color: var(--muted); }
.nota { margin: var(--s-sm) 0 var(--s-lg); font-size: 13px; color: var(--muted); line-height: 1.6; max-width: 62ch; }

.cuotas { margin-top: var(--s-xl); padding-top: var(--s-lg); border-top: 1px solid var(--line); }
.cuotas ul { list-style: none; margin: 0; padding: 0; }
.cuotas li {
  display: grid;
  grid-template-columns: 70px 1fr auto auto;
  align-items: center;
  gap: var(--s-md);
  padding: var(--s-sm) 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.cuotas li:last-child { border-bottom: none; }
.mes { color: var(--muted); }
.monto { color: var(--ink); }
.saldo { font-size: 12px; color: var(--danger); text-align: right; min-width: 8ch; }

.liq { padding: var(--s-lg) 0; border-top: 1px solid var(--line); }
.liq:first-of-type { border-top: none; padding-top: 0; }
.liq > header { display: flex; align-items: center; gap: var(--s-md); margin-bottom: var(--s-sm); }
.neto { font-size: 18px; color: var(--ink); margin-left: auto; }
td { padding: 4px 0; color: var(--ink-2); }
.total td { border-top: 1px solid var(--line); padding-top: var(--s-sm); font-weight: 600; color: var(--ink); }

.aviso { text-align: left; }
.aviso h1 { font-size: 20px; }
.aviso p { margin: var(--s-sm) 0 0; color: var(--muted); }

.pie { padding: var(--s-xl); border-top: 1px solid var(--line); }
.pie p { margin: 0; text-align: center; font-size: 12px; color: var(--muted-2); }

/* Un contador va a imprimir esto. */
@media print {
  .cab, .pie { border: none; }
  .portal { background: #fff; }
  .card { border: 1px solid #ccc; box-shadow: none; break-inside: avoid; }
  .contenido { padding: 0; max-width: none; }
}

@media (max-width: 560px) {
  .cuotas li { grid-template-columns: 1fr auto; row-gap: var(--s-xs); }
  .saldo { grid-column: 1 / -1; text-align: left; }
}
</style>
