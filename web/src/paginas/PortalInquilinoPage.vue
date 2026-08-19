<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import StatusChip from '../componentes/StatusChip.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha, money, periodo as fmtPeriodo } from '../dominio/formato';

/**
 * Lo que ve un inquilino con su enlace. Sin sesión, sin app, sin instalar nada.
 *
 * ── No es la pantalla del propietario con otros datos ──
 *
 * El dueño quiere saber cuánto le entra; el inquilino quiere saber **cuánto
 * debe y hasta cuándo tiene contrato**. Por eso acá no hay una sola mención a
 * honorarios ni a liquidaciones: lo que la inmobiliaria le cobra al dueño no es
 * asunto suyo, y mostrarlo sería filtrar el negocio de un tercero.
 *
 * ── Reportar un desperfecto ──
 *
 * Es el otro motivo por el que alguien abre esto. **La propiedad no se elige**:
 * sale de su contrato vigente, así que el reclamo llega ya identificado y nadie
 * puede reportar sobre una unidad que no habita.
 */

interface Cuota {
  periodo: string; venceEl: string; total: number;
  cobrado: number; saldo: number; moneda: string; estado: string;
}
interface Vista {
  inmobiliaria: string;
  inquilino: string;
  generadoEl: string;
  contratos: Array<{
    propiedad: string; desde: string; hasta: string;
    montoActual: number; moneda: string;
  }>;
  saldo: Array<{ moneda: string; monto: number }>;
  cuotas: Cuota[];
  puedeReportar: boolean;
}

const CATEGORIAS = [
  { clave: 'plomeria', etiqueta: 'Plomería' },
  { clave: 'electricidad', etiqueta: 'Electricidad' },
  { clave: 'gas', etiqueta: 'Gas' },
  { clave: 'humedad', etiqueta: 'Humedad' },
  { clave: 'cerrajeria', etiqueta: 'Cerrajería' },
  { clave: 'climatizacion', etiqueta: 'Climatización' },
  { clave: 'estructura', etiqueta: 'Estructura' },
  { clave: 'artefactos', etiqueta: 'Artefactos' },
  { clave: 'limpieza', etiqueta: 'Limpieza' },
  { clave: 'otro', etiqueta: 'Otro' },
];

const route = useRoute();
const token = route.params.token as string;

const d = ref<Vista | null>(null);
const cargando = ref(true);
const error = ref('');

const reclamo = reactive({
  abierto: false, categoria: 'plomeria', descripcion: '',
  enviando: false, enviado: false, error: '',
});

const alDia = computed(() => d.value !== null && d.value.saldo.length === 0);

/** Las impagas primero: es lo que la persona vino a mirar. */
const cuotasOrdenadas = computed(() => {
  if (!d.value) return [];
  return [...d.value.cuotas].sort((a, b) => {
    if ((a.saldo > 0) !== (b.saldo > 0)) return a.saldo > 0 ? -1 : 1;
    return b.venceEl.localeCompare(a.venceEl);
  });
});

function tono(c: Cuota): 'ok' | 'warn' | 'err' {
  if (c.saldo <= 0) return 'ok';
  return c.venceEl < new Date().toISOString().slice(0, 10) ? 'err' : 'warn';
}

async function cargar() {
  try {
    d.value = await api<Vista>(`/inquilino/${token}`);
  } catch (e) {
    error.value = e instanceof ApiError
      ? e.paraMostrar
      : 'No se pudo abrir. Probá de nuevo en un rato.';
  } finally { cargando.value = false; }
}

async function enviarReclamo() {
  reclamo.enviando = true; reclamo.error = '';
  try {
    await api(`/inquilino/${token}/reclamos`, {
      method: 'POST',
      body: JSON.stringify({ categoria: reclamo.categoria, descripcion: reclamo.descripcion }),
    });
    reclamo.enviado = true; reclamo.abierto = false; reclamo.descripcion = '';
  } catch (e) {
    reclamo.error = e instanceof ApiError ? e.paraMostrar : 'No se pudo enviar.';
  } finally { reclamo.enviando = false; }
}

onMounted(cargar);
</script>

<template>
  <div class="portal">
    <UiSkeleton v-if="cargando" :filas="3" :alto="80" />

    <p v-else-if="error" class="alert" role="alert">{{ error }}</p>

    <template v-else-if="d">
      <header class="cab">
        <span class="inmo">{{ d.inmobiliaria }}</span>
        <h1>Hola, {{ d.inquilino }}</h1>
      </header>

      <!-- El número que se vino a buscar, arriba de todo. -->
      <section class="card saldo-card">
        <template v-if="alDia">
          <StatusChip texto="Estás al día" tono="ok" />
          <p class="nota">No tenés cuotas pendientes.</p>
        </template>
        <template v-else>
          <span class="et">Tenés pendiente</span>
          <strong v-for="s in d.saldo" :key="s.moneda" class="mono debe">
            {{ money(s.monto, s.moneda) }}
          </strong>
        </template>
      </section>

      <section v-if="d.contratos.length" class="card stack">
        <h2>Tu contrato</h2>
        <div v-for="(c, i) in d.contratos" :key="i" class="contrato">
          <strong>{{ c.propiedad }}</strong>
          <span class="mono chico">
            {{ fecha(c.desde) }} — {{ fecha(c.hasta) }} · {{ money(c.montoActual, c.moneda) }}
          </span>
        </div>
      </section>

      <section class="card stack">
        <h2>Tus cuotas</h2>
        <table class="cuotas">
          <thead>
            <tr>
              <th>Período</th><th>Vence</th>
              <th class="der">Total</th><th class="der">Pagado</th><th class="der">Saldo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, i) in cuotasOrdenadas" :key="i">
              <td class="mono">{{ fmtPeriodo(c.periodo) }}</td>
              <td class="mono chico">{{ fecha(c.venceEl) }}</td>
              <td class="der mono">{{ money(c.total, c.moneda) }}</td>
              <td class="der mono">{{ money(c.cobrado, c.moneda) }}</td>
              <td class="der mono">{{ c.saldo > 0 ? money(c.saldo, c.moneda) : '—' }}</td>
              <td><StatusChip :texto="c.saldo > 0 ? 'Pendiente' : 'Pagada'" :tono="tono(c)" /></td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Reportar. Sólo con contrato vigente: sin él no hay propiedad de la
           cual sacar el reclamo, y un formulario que va a fallar no se ofrece. -->
      <section v-if="d.puedeReportar" class="card stack">
        <h2>¿Se rompió algo?</h2>

        <p v-if="reclamo.enviado" class="ok-aviso">
          Listo, ya le llegó a {{ d.inmobiliaria }}. Te van a contactar.
        </p>

        <template v-else-if="!reclamo.abierto">
          <p class="nota">
            Contanos qué pasa y le llega directo a la inmobiliaria, con tu dirección
            ya identificada.
          </p>
          <button class="btn" type="button" @click="reclamo.abierto = true">
            Reportar un desperfecto
          </button>
        </template>

        <form v-else class="stack" @submit.prevent="enviarReclamo">
          <label class="campo">
            <span>¿De qué se trata?</span>
            <select v-model="reclamo.categoria">
              <option v-for="c in CATEGORIAS" :key="c.clave" :value="c.clave">{{ c.etiqueta }}</option>
            </select>
          </label>
          <label class="campo">
            <span>Contanos qué pasa</span>
            <textarea
              v-model="reclamo.descripcion" rows="4" required
              minlength="5" maxlength="2000"
              placeholder="Pierde la canilla de la cocina desde el lunes." />
          </label>
          <p v-if="reclamo.error" class="alert" role="alert">{{ reclamo.error }}</p>
          <div class="row">
            <button class="btn" type="submit" :disabled="reclamo.enviando">
              {{ reclamo.enviando ? 'Enviando…' : 'Enviar' }}
            </button>
            <button class="btn secondary" type="button" @click="reclamo.abierto = false">
              Cancelar
            </button>
          </div>
        </form>
      </section>

      <footer class="pie">
        Ante cualquier duda, hablá con {{ d.inmobiliaria }}.
        Este enlace es personal: no lo compartas.
      </footer>
    </template>
  </div>
</template>

<style scoped>
.portal { max-width: 720px; margin: 0 auto; padding: var(--s-lg); display: flex; flex-direction: column; gap: var(--s-lg); }
.cab { text-align: center; }
.inmo { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.cab h1 { margin: var(--s-2xs) 0 0; font-size: 22px; }

.saldo-card { display: flex; flex-direction: column; align-items: center; gap: var(--s-xs); text-align: center; }
.et { font-size: 12px; color: var(--muted); }
.debe { font-size: 28px; color: var(--ink); }

h2 { margin: 0; font-size: 14px; }
.contrato { display: flex; flex-direction: column; gap: 2px; }
.chico { font-size: 12px; color: var(--muted); }

.cuotas { width: 100%; border-collapse: collapse; }
.cuotas th {
  text-align: left; font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--muted-2); font-weight: 500; padding: 0 var(--s-xs) var(--s-2xs);
}
.cuotas td { padding: var(--s-xs); border-top: 1px solid var(--line); font-size: 13px; }
.der { text-align: right; }

.ok-aviso {
  margin: 0; padding: var(--s-sm) var(--s-md);
  background: var(--ok-tint, var(--surface-2)); border-radius: var(--r-md); font-size: 14px;
}
.nota { margin: 0; font-size: 13px; color: var(--muted); }
.campo select, .campo textarea {
  font: inherit; padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink); width: 100%;
}
.campo textarea { resize: vertical; }
.pie { font-size: 12px; color: var(--muted); text-align: center; }
</style>
