<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha, money, plural } from '../dominio/formato';

/**
 * La cuenta corriente de una persona.
 *
 * ── Dos decisiones que ordenan la pantalla ──
 *
 * **Los dos lados NO se netean.** Alguien puede alquilar una unidad y ser dueño
 * de otra: ahí debe plata y se le debe plata, y son dos cuentas separadas. Un
 * solo número compensado inventaría un acuerdo que nadie firmó, y encima entre
 * plata propia y plata de terceros.
 *
 * **Un saldo vacío dice «al día», no «0».** Cuando la lista de saldos viene
 * vacía es que lo emitido y lo cobrado coinciden. Imprimir «$ 0» ahí es
 * correcto y se lee mal: lo que la persona quiere saber es si tiene que llamar
 * a alguien, y «al día» contesta eso.
 */

interface Importe { moneda: string; monto: number }
interface Movimiento {
  fecha: string;
  tipo: 'debe' | 'haber';
  concepto: string;
  detalle: string | null;
  monto: number;
  moneda: string;
  contratoId: string | null;
}
interface Lado { saldo: Importe[]; movimientos: Movimiento[]; total: number }
interface Cuenta {
  personaId: string;
  nombre: string;
  comoInquilino: Lado | null;
  comoPropietario: Lado | null;
}

const route = useRoute();
const id = route.params.id as string;

const d = ref<Cuenta | null>(null);
const cargando = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    d.value = await api<Cuenta>(`/personas/${id}/cuenta-corriente`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la cuenta.';
  } finally { cargando.value = false; }
});
</script>

<template>
  <div class="stack">
    <UiSkeleton v-if="cargando" :filas="3" :alto="90" />

    <p v-else-if="error" class="alert" role="alert">{{ error }}</p>

    <template v-else-if="d">
      <PageHeader :titulo="d.nombre" bajada="Cuenta corriente" />

      <!-- Ni inquilino ni propietario: no hay cuenta que mostrar, y se dice.
           Dibujar dos paneles en cero sería contestar una pregunta que nadie
           hizo. -->
      <UiEmpty
        v-if="!d.comoInquilino && !d.comoPropietario"
        titulo="Esta persona no tiene cuenta corriente"
        detalle="No es inquilino de ningún contrato ni titular de ninguna propiedad. En cuanto lo sea, sus movimientos aparecen acá." />

      <section v-if="d.comoInquilino" class="card stack">
        <header class="cab">
          <h2>Como inquilino</h2>
          <div class="saldos">
            <template v-if="d.comoInquilino.saldo.length">
              <span class="et">Debe</span>
              <strong v-for="s in d.comoInquilino.saldo" :key="s.moneda" class="mono debe">
                {{ money(s.monto, s.moneda) }}
              </strong>
            </template>
            <StatusChip v-else texto="Al día" tono="ok" />
          </div>
        </header>

        <table class="mov">
          <thead>
            <tr>
              <th>Fecha</th><th>Concepto</th>
              <th class="der">Debe</th><th class="der">Haber</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(m, i) in d.comoInquilino.movimientos" :key="i">
              <td class="mono nowrap">{{ fecha(m.fecha) }}</td>
              <td>
                <RouterLink v-if="m.contratoId" :to="`/contratos/${m.contratoId}`">
                  {{ m.concepto }}
                </RouterLink>
                <template v-else>{{ m.concepto }}</template>
                <span v-if="m.detalle" class="detalle">{{ m.detalle }}</span>
              </td>
              <!-- Cada columna con su moneda: en la misma cuenta puede haber un
                   contrato en ARS y otro en USD, y un número suelto los mezcla. -->
              <td class="der mono">{{ m.tipo === 'debe' ? money(m.monto, m.moneda) : '' }}</td>
              <td class="der mono haber">{{ m.tipo === 'haber' ? money(m.monto, m.moneda) : '' }}</td>
            </tr>
          </tbody>
        </table>

        <p v-if="d.comoInquilino.total > d.comoInquilino.movimientos.length" class="nota">
          Se muestran los últimos {{ d.comoInquilino.movimientos.length }} de
          {{ plural(d.comoInquilino.total, 'movimiento', 'movimientos') }}.
        </p>
      </section>

      <section v-if="d.comoPropietario" class="card stack">
        <header class="cab">
          <h2>Como propietario</h2>
          <div class="saldos">
            <template v-if="d.comoPropietario.saldo.length">
              <span class="et">Se le debe</span>
              <strong v-for="s in d.comoPropietario.saldo" :key="s.moneda" class="mono debe">
                {{ money(s.monto, s.moneda) }}
              </strong>
            </template>
            <StatusChip v-else texto="Sin saldo pendiente" tono="ok" />
          </div>
        </header>

        <table class="mov">
          <thead>
            <tr>
              <th>Período</th><th>Concepto</th>
              <th class="der">Se le debe</th><th class="der">Pagado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(m, i) in d.comoPropietario.movimientos" :key="i">
              <td class="mono nowrap">{{ fecha(m.fecha) }}</td>
              <td>
                {{ m.concepto }}
                <span v-if="m.detalle" class="detalle">{{ m.detalle }}</span>
              </td>
              <td class="der mono">{{ m.tipo === 'debe' ? money(m.monto, m.moneda) : '' }}</td>
              <td class="der mono haber">{{ m.tipo === 'haber' ? money(m.monto, m.moneda) : '' }}</td>
            </tr>
          </tbody>
        </table>

        <!-- Se dice de dónde sale el número: un borrador se puede rearmar, y
             prometerle al dueño una plata que todavía puede cambiar es peor que
             no mostrarla. -->
        <p class="nota">
          Sólo entran las liquidaciones <strong>cerradas</strong>. Un borrador
          todavía se puede rearmar.
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.cab { display: flex; align-items: baseline; gap: var(--s-md); flex-wrap: wrap; }
.cab h2 { margin: 0; margin-right: auto; }
.saldos { display: flex; align-items: baseline; gap: var(--s-sm); flex-wrap: wrap; }
.et { font-size: 12px; color: var(--muted); }
.debe { font-size: 17px; color: var(--ink); }

.mov { width: 100%; border-collapse: collapse; }
.mov th {
  text-align: left; font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--muted-2); font-weight: 500;
  padding: 0 var(--s-sm) var(--s-xs);
}
.mov td {
  padding: var(--s-sm); border-top: 1px solid var(--line);
  font-size: 13px; color: var(--ink-2); vertical-align: top;
}
.der { text-align: right; }
.nowrap { white-space: nowrap; }
.haber { color: var(--ok-ink, var(--acento)); }
.detalle { display: block; font-size: 11px; color: var(--muted); }
.nota { margin: 0; font-size: 12px; color: var(--muted); }
</style>
