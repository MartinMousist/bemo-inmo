<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import PageHeader from '../componentes/PageHeader.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';

/**
 * La política de comisiones de la inmobiliaria, en una sola pantalla.
 *
 * `tenant.comisiones` existía desde la migración 008 con el modelo correcto y
 * no lo leía nadie: cada venta obligaba a tipear los cuatro porcentajes, y el
 * día que alguien tipeaba 30 donde iba 25 no se enteraba nadie.
 *
 * Dos decisiones de esta pantalla:
 *
 * **Las dos unidades, siempre a la vista.** El motor pide el reparto interno en
 * % de lo que le queda a la casa; una inmobiliaria piensa en % de la venta. Con
 * 6% de honorarios, «captador 25% de lo que queda» es «1,5% de la venta»: son
 * el mismo número dicho de dos maneras, y la mitad de las discusiones de fin de
 * mes salen de mezclarlas. Se guarda en la unidad del motor y se muestran las
 * dos.
 *
 * **Las dos puntas están acopladas al total.** Es lo que se pidió: el total es
 * 6% y si una punta sube, la otra baja. El total es editable —una inmobiliaria
 * de otra provincia cobra otra cosa— pero las puntas siempre suman exactamente
 * eso. La cuenta se hace acá y el servidor la vuelve a validar, porque un PUT
 * también llega de afuera de esta pantalla.
 */

interface Config {
  venta: { compradora: number; vendedora: number };
  alquiler: { locataria: number; locadora: number };
  repartoInterno: { captador: number; cerrador: number };
  totalVenta: number;
  casa: number;
  sobreLaVenta: { captador: number; cerrador: number; casa: number };
}

const auth = useAuth();
const ui = useUi();

const puedeEditar = computed(() => auth.rol === 'owner' || auth.rol === 'admin');

const cargando = ref(true);
const guardando = ref(false);
const error = ref('');

const f = reactive({
  compradora: 3,
  vendedora: 3,
  locataria: 0,
  locadora: 100,
  captador: 25,
  cerrador: 25,
});

/** El total de la venta. Editarlo reparte la diferencia entre las dos puntas. */
const total = ref(6);

/** Lo que le queda a la casa después del reparto interno. No se edita: sobra. */
const casa = computed(() => round2(100 - f.captador - f.cerrador));

/**
 * La equivalencia, calculada igual que en el servidor.
 *
 * Vale cuando la operación NO se comparte con otra inmobiliaria: si se comparte,
 * lo que queda se parte y estos números se parten con él. Lo que no cambia es
 * la proporción — y por eso se guarda la proporción y no el % de la venta.
 */
function sobreLaVenta(interno: number): number {
  return round2((total.value * interno) / 100);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Un porcentaje como lo escribe un argentino: 1,5 % y no 1.5%. */
function pct(n: number): string {
  return `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`;
}

function limitar(n: number, max: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(Math.max(n, 0), max);
}

/** Movés una punta, la otra compensa. El total no se toca. */
function ajustarDesde(punta: 'compradora' | 'vendedora') {
  f[punta] = limitar(Number(f[punta]), total.value);
  const otra = punta === 'compradora' ? 'vendedora' : 'compradora';
  f[otra] = round2(total.value - f[punta]);
}

/**
 * Cambiás el total: se reparte proporcionalmente y el resto se le carga a la
 * vendedora. Repartir proporcional y después cuadrar por diferencia evita que
 * 6 → 8 con 4/2 deje 5,33 + 2,67 = 8,00**1** por el redondeo.
 */
function repartirTotal() {
  total.value = limitar(Number(total.value), 100);
  const anterior = f.compradora + f.vendedora;
  if (anterior <= 0) {
    f.compradora = round2(total.value / 2);
  } else {
    f.compradora = round2((f.compradora / anterior) * total.value);
  }
  f.vendedora = round2(total.value - f.compradora);
}

function aplicar(c: Config) {
  f.compradora = c.venta.compradora;
  f.vendedora = c.venta.vendedora;
  f.locataria = c.alquiler.locataria;
  f.locadora = c.alquiler.locadora;
  f.captador = c.repartoInterno.captador;
  f.cerrador = c.repartoInterno.cerrador;
  total.value = c.totalVenta;
}

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    aplicar(await api<Config>('/comisiones/config'));
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la configuración.';
  } finally { cargando.value = false; }
}

async function guardar() {
  guardando.value = true; error.value = '';
  try {
    const c = await api<Config>('/comisiones/config', {
      method: 'PUT',
      body: JSON.stringify({
        venta: { compradora: f.compradora, vendedora: f.vendedora },
        alquiler: { locataria: f.locataria, locadora: f.locadora },
        repartoInterno: { captador: f.captador, cerrador: f.cerrador },
      }),
    });
    aplicar(c);
    ui.ok('Comisiones guardadas', 'Cada venta y cada alquiler nuevos arrancan con estos números.');
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo guardar.';
  } finally { guardando.value = false; }
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Comisiones"
      bajada="Cómo se reparte cada operación. Estos números pre-llenan cada venta y cada alquiler; en la operación se pueden cambiar." />

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <UiSkeleton v-if="cargando" :filas="3" :alto="120" />

    <form v-else class="stack" @submit.prevent="guardar">
      <section class="card stack">
        <h2>Venta · las dos puntas</h2>
        <p class="nota">
          Lo que cobra la operación sobre el precio de cierre. Las dos puntas suman
          el total: si movés una, la otra se ajusta.
        </p>
        <div class="grid">
          <label class="campo"><span>Total de honorarios</span>
            <input v-model.number="total" type="number" min="0" max="100" step="0.01"
              :disabled="!puedeEditar" @change="repartirTotal" />
          </label>
          <label class="campo"><span>Punta compradora</span>
            <input v-model.number="f.compradora" type="number" min="0" :max="total" step="0.01"
              :disabled="!puedeEditar" @change="ajustarDesde('compradora')" />
          </label>
          <label class="campo"><span>Punta vendedora</span>
            <input v-model.number="f.vendedora" type="number" min="0" :max="total" step="0.01"
              :disabled="!puedeEditar" @change="ajustarDesde('vendedora')" />
          </label>
        </div>
        <p class="suma">
          {{ pct(f.compradora) }} + {{ pct(f.vendedora) }} = <strong>{{ pct(total) }}</strong>
          del precio de cierre.
        </p>
      </section>

      <section class="card stack">
        <h2>Alquiler · al firmar</h2>
        <p class="nota">
          La base es <strong>un mes de alquiler</strong>, así que 100 % es un mes entero.
          Es la comisión del cierre: los honorarios de administración son otra cosa y
          se descuentan mes a mes en la liquidación del propietario.
        </p>
        <div class="grid">
          <label class="campo"><span>Punta locataria</span>
            <input v-model.number="f.locataria" type="number" min="0" max="100" step="0.01"
              :disabled="!puedeEditar" />
          </label>
          <label class="campo"><span>Punta locadora</span>
            <input v-model.number="f.locadora" type="number" min="0" max="100" step="0.01"
              :disabled="!puedeEditar" />
          </label>
        </div>
      </section>

      <section class="card stack">
        <h2>Puertas adentro · quién se lleva qué</h2>
        <p class="nota">
          Sobre <strong>lo que le queda a la inmobiliaria</strong> después de repartir con
          otra agencia, si la hubo. La columna de la derecha es el mismo número en
          la unidad en la que se piensa: % de la venta.
        </p>

        <table class="reparto">
          <thead>
            <tr>
              <th>Quién</th>
              <th>% de lo que queda</th>
              <th>≡ % de la venta</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Captador</th>
              <td>
                <input v-model.number="f.captador" type="number" min="0" max="100" step="0.01"
                  :disabled="!puedeEditar" aria-label="Porcentaje del captador" />
              </td>
              <td class="equiv">{{ pct(sobreLaVenta(f.captador)) }}</td>
            </tr>
            <tr>
              <th scope="row">Quien cierra</th>
              <td>
                <input v-model.number="f.cerrador" type="number" min="0" max="100" step="0.01"
                  :disabled="!puedeEditar" aria-label="Porcentaje de quien cierra" />
              </td>
              <td class="equiv">{{ pct(sobreLaVenta(f.cerrador)) }}</td>
            </tr>
            <tr :class="{ negativo: casa < 0 }">
              <th scope="row">La casa</th>
              <td class="resto">{{ pct(casa) }}</td>
              <td class="equiv">{{ pct(sobreLaVenta(casa)) }}</td>
            </tr>
          </tbody>
        </table>

        <p v-if="casa < 0" class="alert" role="alert">
          El captador y quien cierra se están llevando más del 100 %: a la casa no le
          queda nada. Bajá alguno de los dos.
        </p>

        <p class="nota">
          La equivalencia vale cuando la operación no se comparte. Si entra otra
          inmobiliaria, lo que queda se parte y estas tres porciones se parten con
          él —por eso se guarda la proporción y no el % de la venta: un captador con
          1,5 % fijo se llevaría la mitad de lo que entró.
        </p>
      </section>

      <div v-if="puedeEditar" class="acciones">
        <button class="btn" type="submit" :disabled="guardando || casa < 0">
          {{ guardando ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
      <p v-else class="nota">
        Sólo el titular y administración pueden cambiar estos números. Los ves para
        saber con qué reparto trabajás.
      </p>
    </form>
  </div>
</template>

<style scoped>
.nota { margin: 0; font-size: 13px; color: var(--muted); max-width: 72ch; line-height: 1.6; }
.suma { margin: 0; font-size: 13px; color: var(--ink-2); }
.reparto { width: 100%; border-collapse: collapse; }
.reparto th, .reparto td { padding: var(--s-sm) var(--s-md); text-align: left; border-bottom: 1px solid var(--line); }
.reparto thead th { font-size: 12px; color: var(--muted); font-weight: 500; }
.reparto tbody th { font-weight: 500; }
.reparto input { width: 8ch; }
.equiv { color: var(--ink-2); font-variant-numeric: tabular-nums; }
.resto { color: var(--muted); font-variant-numeric: tabular-nums; }
.negativo td, .negativo th { color: var(--danger); }
.acciones { display: flex; gap: var(--s-sm); }
</style>
