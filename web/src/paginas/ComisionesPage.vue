<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import PageHeader from '../componentes/PageHeader.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import StatusChip from '../componentes/StatusChip.vue';
import { money } from '../dominio/formato';
import { ETIQUETA_ESTADO, TONO_ESTADO } from '../dominio/comisiones';

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

// ── El catálogo de inmobiliarias con las que se comparte ────────────────────
//
// Nace acá, en la misma pantalla donde vive la política de comisiones: una
// tabla sin pantalla es una feature que no existe (error #3 del playbook, que
// este módulo ya cometió cuatro veces).
//
// Lo que contesta y antes era imposible: cuánto se le pagó a cada agencia. Con
// el nombre escrito a mano en cada comisión, «Propiedades del Oeste», «Prop.
// del Oeste» y «propiedades del oeste» eran tres agencias distintas.

interface Externa {
  id: string;
  nombre: string;
  cuit: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  activa: boolean;
  pagado: Array<{ moneda: string; estado: string; total: number; operaciones: number }>;
}

const externas = ref<Externa[]>([]);
const cargandoExternas = ref(true);
const verInactivas = ref(false);
const nuevaExterna = reactive({ nombre: '', cuit: '', contacto: '', telefono: '', email: '' });
const creandoExterna = ref(false);

async function cargarExternas() {
  cargandoExternas.value = true;
  try {
    externas.value = await api<Externa[]>(
      `/comisiones/externas${verInactivas.value ? '?todas=true' : ''}`,
    );
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar el catálogo.';
  } finally { cargandoExternas.value = false; }
}

async function crearExterna() {
  creandoExterna.value = true; error.value = '';
  try {
    await api<Externa>('/comisiones/externas', {
      method: 'POST',
      body: JSON.stringify({
        nombre: nuevaExterna.nombre.trim(),
        ...(nuevaExterna.cuit.trim() ? { cuit: nuevaExterna.cuit.trim() } : {}),
        ...(nuevaExterna.contacto.trim() ? { contacto: nuevaExterna.contacto.trim() } : {}),
        ...(nuevaExterna.telefono.trim() ? { telefono: nuevaExterna.telefono.trim() } : {}),
        ...(nuevaExterna.email.trim() ? { email: nuevaExterna.email.trim() } : {}),
      }),
    });
    ui.ok('Inmobiliaria cargada', `«${nuevaExterna.nombre.trim()}» ya se puede elegir al repartir.`);
    nuevaExterna.nombre = ''; nuevaExterna.cuit = '';
    nuevaExterna.contacto = ''; nuevaExterna.telefono = ''; nuevaExterna.email = '';
    await cargarExternas();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la inmobiliaria.';
  } finally { creandoExterna.value = false; }
}

/**
 * Dar de baja NO borra: desactiva.
 *
 * Un DELETE se llevaría puesto el enlace de las comisiones ya pagadas —la FK es
 * `ON DELETE SET NULL`— y con él la única forma de sumar el histórico por
 * agencia. Desactivada sale del autocompletar y sigue en el registro.
 */
async function alternarExterna(e: Externa) {
  error.value = '';
  try {
    await api(`/comisiones/externas/${e.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activa: !e.activa }),
    });
    await cargarExternas();
  } catch (err) {
    error.value = err instanceof ApiError ? err.paraMostrar : 'No se pudo cambiar el estado.';
  }
}

onMounted(() => {
  void cargar();
  void cargarExternas();
});
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

    <!-- ── El catálogo de inmobiliarias con las que se comparte ───────────── -->
    <section class="card stack">
      <div class="row entre">
        <h2>Inmobiliarias con las que compartimos</h2>
        <label class="tilde">
          <input v-model="verInactivas" type="checkbox" @change="cargarExternas" />
          <span>Ver las dadas de baja</span>
        </label>
      </div>
      <p class="nota">
        Cuando una operación se comparte, la otra agencia se elige de acá. Sirve para
        contestar cuánto se le pagó a cada una: con el nombre escrito a mano en cada
        comisión, «Propiedades del Oeste» y «Prop. del Oeste» eran dos agencias
        distintas. El nombre queda <strong>congelado</strong> en la comisión: renombrar
        una ficha no cambia a quién se le pagó.
      </p>

      <p v-if="cargandoExternas" class="nota">Cargando…</p>
      <p v-else-if="!externas.length" class="nota">
        Todavía no hay ninguna cargada. También se puede dar de alta en el momento, desde
        el reparto de una venta o de un contrato.
      </p>

      <table v-else class="externas">
        <thead>
          <tr><th>Nombre</th><th>Contacto</th><th>Se le pagó</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="e in externas" :key="e.id" :class="{ inactiva: !e.activa }">
            <td>
              <strong>{{ e.nombre }}</strong>
              <!-- En bloque: en línea, «Propiedades del OesteCUIT 30712345678»
                   se lee como una sola palabra. -->
              <span v-if="e.cuit" class="mono chica bloque">CUIT {{ e.cuit }}</span>
              <span v-if="!e.activa" class="chica baja">dada de baja</span>
            </td>
            <td class="chica">
              <span v-if="e.contacto">{{ e.contacto }}</span>
              <span v-if="e.telefono" class="mono bloque">{{ e.telefono }}</span>
              <span v-if="e.email" class="mono bloque">{{ e.email }}</span>
              <span v-if="!e.contacto && !e.telefono && !e.email">—</span>
            </td>
            <td>
              <!-- Por moneda Y por estado: ARS y USD no se suman nunca, y
                   «cobrada» y «proyectada» tampoco — una es plata que salió y
                   la otra una promesa. -->
              <span v-for="(p, i) in e.pagado" :key="i" class="pago">
                <span class="mono">{{ money(p.total, p.moneda) }}</span>
                <StatusChip
                  :texto="ETIQUETA_ESTADO[p.estado] ?? p.estado"
                  :tono="TONO_ESTADO[p.estado] ?? 'neutro'" />
              </span>
              <span v-if="!e.pagado.length" class="chica">todavía nada</span>
            </td>
            <td class="der">
              <button
                v-if="puedeEditar" class="btn secondary sm" type="button"
                @click="alternarExterna(e)">
                {{ e.activa ? 'Dar de baja' : 'Reactivar' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <form v-if="puedeEditar" class="alta" @submit.prevent="crearExterna">
        <label class="campo"><span>Nombre</span>
          <input v-model="nuevaExterna.nombre" required maxlength="120" placeholder="Agencia" />
        </label>
        <label class="campo"><span>CUIT</span>
          <input v-model="nuevaExterna.cuit" maxlength="20" placeholder="30-12345678-9" />
        </label>
        <label class="campo"><span>Contacto</span>
          <input v-model="nuevaExterna.contacto" maxlength="120" placeholder="Nombre y apellido" />
        </label>
        <label class="campo"><span>Teléfono</span>
          <input v-model="nuevaExterna.telefono" maxlength="40" />
        </label>
        <label class="campo"><span>Correo</span>
          <input v-model="nuevaExterna.email" type="email" maxlength="160" />
        </label>
        <button class="btn" type="submit" :disabled="creandoExterna || !nuevaExterna.nombre.trim()">
          Agregar
        </button>
      </form>
      <p v-else class="nota">
        Un asesor puede cargar una inmobiliaria en el momento, desde el reparto de la
        operación. Darlas de baja es del titular y administración.
      </p>
    </section>
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

.tilde { display: inline-flex; align-items: center; gap: var(--s-sm); font-size: 12px; color: var(--muted); cursor: pointer; }
.externas { width: 100%; border-collapse: collapse; }
.externas th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); padding-bottom: var(--s-sm); border-bottom: 1px solid var(--line); }
.externas td { padding: var(--s-md) var(--s-sm) var(--s-md) 0; border-bottom: 1px solid var(--line); color: var(--ink-2); font-size: 13px; vertical-align: top; }
.externas tr:last-child td { border-bottom: none; }
.externas .der { text-align: right; }
.inactiva { opacity: 0.6; }
.chica { font-size: 11px; color: var(--muted-2); }
.bloque { display: block; }
.baja { display: block; color: var(--warning-ink); }
.pago { display: inline-flex; align-items: center; gap: var(--s-xs); margin-right: var(--s-md); }
.alta { display: flex; align-items: flex-end; gap: var(--s-md); flex-wrap: wrap; padding-top: var(--s-md); border-top: 1px solid var(--line); }
.alta .campo { display: flex; flex-direction: column; gap: var(--s-xs); }
.alta .campo > span { font-size: 11px; color: var(--muted); }
.alta input {
  font: inherit; font-size: 13px; padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink); width: 18ch;
}
</style>
