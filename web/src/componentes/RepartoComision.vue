<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useUi } from '../stores/ui';
import { money } from '../dominio/formato';
import { pct } from '../dominio/comisiones';

/**
 * El formulario de reparto, compartido entre una venta y un alquiler.
 *
 * Es el mismo motor de los dos lados —cambian las puntas y la base—, así que
 * es el mismo formulario. Duplicarlo habría dejado dos pantallas que se
 * separan en el primer campo nuevo.
 *
 * ── Cuatro decisiones ──
 *
 * **El servidor sugiere, la pantalla rellena, la persona confirma.** Todo llega
 * pre-cargado desde `…/sugerido`: las puntas de la política de la casa (o de la
 * propiedad, si tiene la suya), el captador desde `propiedad.agente_captador_id`
 * y el cerrador desde quien está usando el sistema. Y **todo es editable**: el
 * captador no siempre es quien cargó la propiedad. Lo automático es un valor
 * por defecto, no un hecho.
 *
 * **Compartir muestra el antes y el después, en plata.** Tildar «comparte
 * comisión» no sólo le saca la mitad a la casa: el nivel 3 se aplica sobre lo
 * que queda de CADA punta después del nivel 2, así que también le baja la
 * comisión al agente a la mitad. Eso no es obvio, y alguien puede tildar la
 * casilla sin entender qué firmó. Por eso al lado de cada punta se ve cuánto se
 * lleva cada uno, calculado con la misma aritmética del motor.
 *
 * **La inmobiliaria sale del catálogo, y se puede dar de alta acá mismo.** Quien
 * está cerrando a las siete de la tarde no puede quedar trabado esperando que
 * el titular cargue una ficha. El nombre igual viaja y se congela en la
 * comisión: si mañana renombran la agencia, lo que ya se pagó no cambia de
 * acreedor.
 *
 * **Cada input dice de qué es porcentaje.** Los tres números de esta pantalla
 * están en unidades distintas —la punta es % del precio, la externa es % de la
 * punta, el agente es % de lo que le queda a la casa— y mezclarlas es la razón
 * por la que estas cuentas dan mal.
 */

type Punta = 'compradora' | 'vendedora' | 'locataria' | 'locadora';

const props = defineProps<{
  /** `/ventas/:id/reparto` o `/contratos/:id/comisiones`. */
  urlReparto: string;
  /** `/ventas/:id/reparto/sugerido` o `/contratos/:id/comisiones/sugerido`. */
  urlSugerido: string;
  tipo: 'venta' | 'alquiler';
  /** `true` si hay una comisión cobrada: no se puede rehacer. */
  bloqueada: boolean;
}>();

const emit = defineEmits<{ (e: 'guardado'): void; (e: 'cancelar'): void }>();

const ui = useUi();

interface Agente { usuarioId: string; nombre: string; porcentaje: number; propio: boolean }
interface Sugerencia {
  base: number;
  moneda: string;
  puntas: Record<string, number>;
  puntasHeredadas: boolean;
  captador: Agente | null;
  cerrador: Agente;
  repartoInternoCasa: { captador: number; cerrador: number };
}
interface Externa { id: string; nombre: string; activa: boolean }
interface Miembro { usuarioId: string; nombre: string; rol: string; estado: string }

const PUNTAS: Record<'venta' | 'alquiler', Array<{ clave: Punta; etiqueta: string }>> = {
  venta: [
    { clave: 'compradora', etiqueta: 'Punta compradora' },
    { clave: 'vendedora', etiqueta: 'Punta vendedora' },
  ],
  alquiler: [
    { clave: 'locataria', etiqueta: 'Punta locataria' },
    { clave: 'locadora', etiqueta: 'Punta locadora' },
  ],
};

const cargando = ref(true);
const guardando = ref(false);
const error = ref('');
const s = ref<Sugerencia | null>(null);
const externas = ref<Externa[]>([]);
const equipo = ref<Miembro[]>([]);

/** El estado editable del formulario. */
const f = reactive({
  puntas: {} as Record<string, number>,
  comparte: {} as Record<string, boolean>,
  externaNombre: {} as Record<string, string>,
  externaId: {} as Record<string, string>,
  externaPct: {} as Record<string, number>,
  captadorId: '',
  captadorPct: 0,
  cerradorId: '',
  cerradorPct: 0,
});

const laLista = computed(() => PUNTAS[props.tipo]);

/** Sólo los que pueden cobrar una comisión: los suspendidos no. */
const agentes = computed(() => equipo.value.filter((m) => m.estado === 'activa'));

const base = computed(() => s.value?.base ?? 0);
const moneda = computed(() => s.value?.moneda ?? 'ARS');

/**
 * La cuenta de una punta, con la MISMA aritmética del motor.
 *
 * Se recalcula en el navegador para que el número se vea mientras se escribe;
 * el servidor la vuelve a hacer y es el que manda. Si algún día difieren, la
 * que vale es la del servidor — por eso después de guardar la pantalla muestra
 * lo que devolvió la API, no esto.
 */
function cuentaDe(punta: Punta) {
  const pctPunta = Number(f.puntas[punta] ?? 0);
  const bruto = r2((base.value * pctPunta) / 100);
  const pctExterna = f.comparte[punta] ? Number(f.externaPct[punta] ?? 0) : 0;
  const aExterna = r2((bruto * pctExterna) / 100);
  const queda = r2(bruto - aExterna);
  const aCaptador = f.captadorId ? r2((queda * Number(f.captadorPct)) / 100) : 0;
  const aCerrador = f.cerradorId ? r2((queda * Number(f.cerradorPct)) / 100) : 0;
  const aLaCasa = r2(queda - aCaptador - aCerrador);
  // Sin compartir: lo mismo pero con la externa en cero. Es el «antes» que hace
  // visible qué cambia al tildar la casilla.
  const sinCompartir = {
    captador: f.captadorId ? r2((bruto * Number(f.captadorPct)) / 100) : 0,
    cerrador: f.cerradorId ? r2((bruto * Number(f.cerradorPct)) / 100) : 0,
  };
  return { bruto, aExterna, queda, aCaptador, aCerrador, aLaCasa, sinCompartir };
}

const totales = computed(() => {
  let operacion = 0, ext = 0, ag = 0, casa = 0;
  for (const { clave } of laLista.value) {
    const c = cuentaDe(clave);
    operacion = r2(operacion + c.bruto);
    ext = r2(ext + c.aExterna);
    ag = r2(ag + c.aCaptador + c.aCerrador);
    casa = r2(casa + c.aLaCasa);
  }
  return { operacion, ext, ag, casa };
});

/** El captador y el cerrador no pueden llevarse más de lo que hay. */
const seExcede = computed(() => {
  const suma = (f.captadorId ? Number(f.captadorPct) : 0) +
    (f.cerradorId ? Number(f.cerradorPct) : 0);
  return suma > 100;
});

function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const [sug, ext, eq] = await Promise.all([
      api<Sugerencia>(props.urlSugerido),
      api<Externa[]>('/comisiones/externas'),
      api<{ miembros: Miembro[] }>('/equipo'),
    ]);
    s.value = sug;
    externas.value = ext;
    equipo.value = eq.miembros;

    for (const { clave } of laLista.value) {
      f.puntas[clave] = sug.puntas[clave] ?? 0;
      f.comparte[clave] = false;
      f.externaNombre[clave] = '';
      f.externaId[clave] = '';
      f.externaPct[clave] = 50;
    }
    f.captadorId = sug.captador?.usuarioId ?? '';
    f.captadorPct = sug.captador?.porcentaje ?? sug.repartoInternoCasa.captador;
    f.cerradorId = sug.cerrador.usuarioId;
    f.cerradorPct = sug.cerrador.porcentaje;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo armar el reparto.';
  } finally { cargando.value = false; }
}

/**
 * Al elegir a otra persona, se trae SU porcentaje.
 *
 * Sin esto, cambiar el captador dejaría el % del anterior y nadie lo notaría:
 * el número se ve igual de razonable. Se pide al servidor porque el % vive en
 * la membresía y puede ser distinto del de la casa.
 */
async function traerPct(usuarioId: string, rol: 'captador' | 'cerrador') {
  if (!usuarioId) return;
  try {
    const p = await api<{
      comisionCaptadorPct: number | null; comisionCerradorPct: number | null;
      heredado: { captador: number; cerrador: number };
    }>(`/equipo/${usuarioId}/perfil`);
    if (rol === 'captador') {
      f.captadorPct = p.comisionCaptadorPct ?? p.heredado.captador;
    } else {
      f.cerradorPct = p.comisionCerradorPct ?? p.heredado.cerrador;
    }
  } catch {
    // Si falla, se deja el número que ya estaba: es peor dejarlo en cero.
  }
}

watch(() => f.captadorId, (v) => void traerPct(v, 'captador'));
watch(() => f.cerradorId, (v) => void traerPct(v, 'cerrador'));

/** Al elegir del catálogo, el nombre se copia: es el que se congela. */
function elegirExterna(punta: Punta, id: string) {
  f.externaId[punta] = id;
  const e = externas.value.find((x) => x.id === id);
  if (e) f.externaNombre[punta] = e.nombre;
}

/** Alta al vuelo. Un asesor la puede hacer: ver el comentario del controlador. */
async function altaExterna(punta: Punta) {
  const nombre = f.externaNombre[punta]?.trim();
  if (!nombre) return;
  try {
    const nueva = await api<Externa>('/comisiones/externas', {
      method: 'POST',
      body: JSON.stringify({ nombre }),
    });
    externas.value = [...externas.value, nueva];
    f.externaId[punta] = nueva.id;
    ui.ok('Inmobiliaria cargada', `«${nueva.nombre}» ya está en el catálogo.`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la inmobiliaria.';
  }
}

async function guardar() {
  guardando.value = true; error.value = '';
  try {
    const puntas: Record<string, number> = {};
    const externasBody: Record<string, unknown> = {};

    for (const { clave } of laLista.value) {
      const p = Number(f.puntas[clave] ?? 0);
      // Una punta en cero no se manda: el motor no emitiría línea y el reparto
      // igual cuadra, pero mandarla ensucia el body y confunde al leerlo.
      if (p > 0) puntas[clave] = p;
      if (f.comparte[clave] && p > 0) {
        externasBody[clave] = {
          nombre: f.externaNombre[clave]?.trim(),
          porcentaje: Number(f.externaPct[clave] ?? 0),
          ...(f.externaId[clave] ? { externaId: f.externaId[clave] } : {}),
        };
      }
    }

    const repartoInterno: Record<string, unknown> = {};
    if (f.captadorId && Number(f.captadorPct) > 0) {
      repartoInterno.captador = {
        usuarioId: f.captadorId,
        nombre: agentes.value.find((a) => a.usuarioId === f.captadorId)?.nombre ?? 'Captador',
        porcentaje: Number(f.captadorPct),
      };
    }
    if (f.cerradorId && Number(f.cerradorPct) > 0) {
      repartoInterno.cerrador = {
        usuarioId: f.cerradorId,
        nombre: agentes.value.find((a) => a.usuarioId === f.cerradorId)?.nombre ?? 'Cerrador',
        porcentaje: Number(f.cerradorPct),
      };
    }

    await api(props.urlReparto, {
      method: 'POST',
      body: JSON.stringify({
        puntas,
        ...(Object.keys(externasBody).length ? { externas: externasBody } : {}),
        ...(Object.keys(repartoInterno).length ? { repartoInterno } : {}),
      }),
    });

    ui.ok('Reparto guardado', `${money(totales.value.operacion, moneda.value)} repartidos.`);
    emit('guardado');
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo guardar el reparto.';
  } finally { guardando.value = false; }
}

onMounted(cargar);
</script>

<template>
  <form class="stack" @submit.prevent="guardar">
    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <p v-if="bloqueada" class="alert" role="alert">
      Ya hay una comisión <strong>cobrada</strong> en esta operación: el reparto no se
      puede rehacer. Anulá esa comisión primero.
    </p>

    <p v-if="cargando" class="nota">Armando el reparto…</p>

    <template v-else-if="s">
      <p class="nota">
        Base del cálculo: <strong class="mono">{{ money(base, moneda) }}</strong>
        <template v-if="tipo === 'alquiler'"> — un mes de alquiler, congelado al firmar</template>.
        Los porcentajes vienen de
        {{ s.puntasHeredadas ? 'la política de la inmobiliaria' : 'esta propiedad, que tiene los suyos' }};
        podés cambiarlos acá y sólo afectan a esta operación.
      </p>

      <section v-for="p in laLista" :key="p.clave" class="punta card">
        <div class="fila">
          <label class="campo">
            <span>{{ p.etiqueta }} · % de la base</span>
            <input
              v-model.number="f.puntas[p.clave]"
              type="number" min="0" max="100" step="0.01" :disabled="bloqueada" />
          </label>
          <span class="mono resultado">{{ money(cuentaDe(p.clave).bruto, moneda) }}</span>
        </div>

        <label class="tilde">
          <input
            v-model="f.comparte[p.clave]" type="checkbox"
            :disabled="bloqueada || !Number(f.puntas[p.clave])" />
          <span>Comparte comisión con otra inmobiliaria</span>
        </label>
        <p v-if="!Number(f.puntas[p.clave])" class="nota chica">
          Esta punta no cobra honorarios, así que no hay nada que compartir. Cargale un
          porcentaje primero.
        </p>

        <div v-if="f.comparte[p.clave]" class="compartir">
          <label class="campo ancho">
            <span>Qué inmobiliaria</span>
            <input
              v-model="f.externaNombre[p.clave]"
              :list="`externas-${p.clave}`"
              type="text" maxlength="120" placeholder="Nombre de la agencia"
              :disabled="bloqueada"
              @change="elegirExterna(
                p.clave,
                externas.find((x) => x.nombre === f.externaNombre[p.clave])?.id ?? '')" />
            <datalist :id="`externas-${p.clave}`">
              <option v-for="e in externas" :key="e.id" :value="e.nombre" />
            </datalist>
          </label>

          <button
            v-if="f.externaNombre[p.clave]?.trim() &&
                  !externas.some((x) => x.nombre === f.externaNombre[p.clave]?.trim())"
            class="btn secondary sm" type="button" :disabled="bloqueada"
            @click="altaExterna(p.clave)"
          >
            Cargarla al catálogo
          </button>

          <label class="campo">
            <span>Se lleva · % de esta punta</span>
            <input
              v-model.number="f.externaPct[p.clave]"
              type="number" min="0" max="100" step="0.01" :disabled="bloqueada" />
          </label>

          <div class="atajos">
            <button
              v-for="v in [50, 60, 40]" :key="v" class="btn secondary sm" type="button"
              :disabled="bloqueada" @click="f.externaPct[p.clave] = v">
              {{ v }} %
            </button>
          </div>
        </div>

        <!-- El antes y el después, en plata. Compartir no sólo le saca a la
             casa: el reparto interno se aplica sobre lo que QUEDA, así que
             también le baja la comisión al agente. Sin esto, alguien tilda la
             casilla sin entender qué firmó. -->
        <table class="cuenta">
          <tbody>
            <tr v-if="f.comparte[p.clave] && cuentaDe(p.clave).aExterna > 0">
              <th scope="row">{{ f.externaNombre[p.clave] || 'La otra inmobiliaria' }}</th>
              <td class="mono">{{ money(cuentaDe(p.clave).aExterna, moneda) }}</td>
              <td class="nota chica">{{ pct(Number(f.externaPct[p.clave] || 0)) }} de la punta</td>
            </tr>
            <tr v-if="f.captadorId && Number(f.captadorPct) > 0">
              <th scope="row">Captador</th>
              <td class="mono">{{ money(cuentaDe(p.clave).aCaptador, moneda) }}</td>
              <td class="nota chica">
                {{ pct(Number(f.captadorPct)) }} de lo que queda
                <template v-if="f.comparte[p.clave] && cuentaDe(p.clave).aExterna > 0">
                  · sin compartir sería
                  {{ money(cuentaDe(p.clave).sinCompartir.captador, moneda) }}
                </template>
              </td>
            </tr>
            <tr v-if="f.cerradorId && Number(f.cerradorPct) > 0">
              <th scope="row">Quien cierra</th>
              <td class="mono">{{ money(cuentaDe(p.clave).aCerrador, moneda) }}</td>
              <td class="nota chica">
                {{ pct(Number(f.cerradorPct)) }} de lo que queda
                <template v-if="f.comparte[p.clave] && cuentaDe(p.clave).aExterna > 0">
                  · sin compartir sería
                  {{ money(cuentaDe(p.clave).sinCompartir.cerrador, moneda) }}
                </template>
              </td>
            </tr>
            <tr>
              <th scope="row">La casa</th>
              <td class="mono">{{ money(cuentaDe(p.clave).aLaCasa, moneda) }}</td>
              <td class="nota chica">lo que sobra de esta punta</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card stack">
        <h3>Puertas adentro</h3>
        <p class="nota">
          Estos dos porcentajes son <strong>% de lo que le queda a la inmobiliaria</strong>
          después de repartir con la otra agencia — no % de la operación. Vienen del
          porcentaje de cada persona; si no tiene uno propio, del de la casa
          ({{ pct(s.repartoInternoCasa.captador) }} y {{ pct(s.repartoInternoCasa.cerrador) }}).
        </p>

        <div class="fila">
          <label class="campo ancho">
            <span>Quién captó</span>
            <select v-model="f.captadorId" :disabled="bloqueada">
              <option value="">Nadie</option>
              <option v-for="a in agentes" :key="a.usuarioId" :value="a.usuarioId">
                {{ a.nombre }}
              </option>
            </select>
          </label>
          <label class="campo">
            <span>% de lo que queda</span>
            <input
              v-model.number="f.captadorPct" type="number" min="0" max="100" step="0.01"
              :disabled="bloqueada || !f.captadorId" />
          </label>
        </div>
        <p v-if="s.captador && f.captadorId === s.captador.usuarioId" class="nota chica">
          Sugerido desde la ficha de la propiedad. Cambialo si captó otra persona.
        </p>

        <div class="fila">
          <label class="campo ancho">
            <span>Quién cerró</span>
            <select v-model="f.cerradorId" :disabled="bloqueada">
              <option value="">Nadie</option>
              <option v-for="a in agentes" :key="a.usuarioId" :value="a.usuarioId">
                {{ a.nombre }}
              </option>
            </select>
          </label>
          <label class="campo">
            <span>% de lo que queda</span>
            <input
              v-model.number="f.cerradorPct" type="number" min="0" max="100" step="0.01"
              :disabled="bloqueada || !f.cerradorId" />
          </label>
        </div>

        <p v-if="seExcede" class="alert" role="alert">
          Entre los dos se llevan más del 100 % de lo que le queda a la inmobiliaria:
          a la casa no le quedaría nada.
        </p>
      </section>

      <div class="card resumen">
        <div><span class="et">Factura la operación</span>
          <span class="mono grande">{{ money(totales.operacion, moneda) }}</span></div>
        <div v-if="totales.ext > 0"><span class="et">A otra inmobiliaria</span>
          <span class="mono">{{ money(totales.ext, moneda) }}</span></div>
        <div><span class="et">A los agentes</span>
          <span class="mono">{{ money(totales.ag, moneda) }}</span></div>
        <div><span class="et">Queda en la casa</span>
          <span class="mono">{{ money(totales.casa, moneda) }}</span></div>
      </div>

      <div class="acciones">
        <button class="btn" type="submit" :disabled="guardando || bloqueada || seExcede">
          {{ guardando ? 'Guardando…' : 'Guardar el reparto' }}
        </button>
        <button class="btn secondary" type="button" @click="emit('cancelar')">Cancelar</button>
      </div>
    </template>
  </form>
</template>

<style scoped>
.nota { margin: 0; font-size: 13px; color: var(--muted); max-width: 78ch; line-height: 1.6; }
.chica { font-size: 11px; }
.punta { display: flex; flex-direction: column; gap: var(--s-md); }
.fila { display: flex; align-items: flex-end; gap: var(--s-md); flex-wrap: wrap; }
.campo { display: flex; flex-direction: column; gap: var(--s-xs); }
.campo > span { font-size: 11px; color: var(--muted); }
.campo input, .campo select {
  font: inherit; padding: var(--s-sm) var(--s-md); border: 1px solid var(--line-strong);
  border-radius: var(--r-md); background: var(--surface); color: var(--ink); width: 12ch;
}
.campo.ancho input, .campo.ancho select { width: 26ch; }
.resultado { color: var(--ink); font-size: 15px; padding-bottom: var(--s-sm); }
.tilde { display: inline-flex; align-items: center; gap: var(--s-sm); font-size: 13px; color: var(--ink-2); cursor: pointer; }
.compartir { display: flex; align-items: flex-end; gap: var(--s-md); flex-wrap: wrap; padding: var(--s-md); background: var(--surface-2); border-radius: var(--r-md); }
.atajos { display: flex; gap: var(--s-xs); padding-bottom: var(--s-sm); }
.cuenta { width: 100%; border-collapse: collapse; }
.cuenta th { text-align: left; font-weight: 500; font-size: 12px; color: var(--ink-2); padding: var(--s-xs) 0; }
.cuenta td { padding: var(--s-xs) var(--s-md); font-size: 12px; color: var(--ink-2); }
.resumen { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--s-lg); }
.resumen > div { display: flex; flex-direction: column; gap: 2px; }
.et { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-2); }
.grande { font-size: 18px; color: var(--ink); }
.acciones { display: flex; gap: var(--s-sm); }
</style>
