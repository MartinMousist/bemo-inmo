<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha, numero } from '../dominio/formato';

interface Limite { recurso: string; usado: number; maximo: number | null; permitido: boolean }
interface Estado {
  plan: { codigo: string; nombre: string; modulos: string[] };
  estado: string; pruebaHasta: string | null; limites: Limite[];
  cobro: { integrado: boolean; detalle: string };
}
interface Plan {
  codigo: string; familia: 'gestion' | 'inmobiliaria'; nombre: string;
  resumen: string | null; paraQuien: string | null;
  maxUsuarios: number | null; maxPropiedades: number | null;
  maxContratos: number | null; maxCanales: number | null;
  maxEnviosMes: number | null; maxRedCompartidas: number | null;
  modulos: string[]; precio: number | null;
}

const mio = ref<Estado | null>(null);
const catalogo = ref<Plan[]>([]);
const cargando = ref(true);
const error = ref('');

const RECURSO: Record<string, string> = {
  usuarios: 'Usuarios', propiedades: 'Propiedades', contratos: 'Contratos vigentes',
  sucursales: 'Sucursales', canales: 'Canales de la bandeja',
  envios_mes: 'Envíos este mes', red_compartidas: 'Compartidas en la Red',
};

/**
 * Cómo se llama cada módulo EN CASTELLANO.
 *
 * Este mapa estaba desactualizado y las claves que no encontraba caían al valor
 * crudo: la página de planes mostraba «bandeja», «arca», «marca_blanca». Un
 * nombre interno en una pantalla de precios le pide a quien la lee que adivine
 * de qué le están hablando.
 *
 * El detalle NO es la definición del módulo: es lo que se pierde sin él, que es
 * la única pregunta que alguien se hace mirando planes.
 */
const MODULO: Record<string, { nombre: string; detalle: string }> = {
  leads: { nombre: 'Leads', detalle: 'Quién preguntó por qué propiedad y en qué anda' },
  ventas: { nombre: 'Ventas', detalle: 'Reserva, boleto y escritura' },
  reservas: { nombre: 'Reservas', detalle: 'Señas tomadas y su vencimiento' },
  comisiones: { nombre: 'Comisiones', detalle: 'El reparto entre la casa y cada agente' },
  publicaciones: { nombre: 'Publicaciones', detalle: 'El aviso y el feed a los portales' },
  liquidaciones: { nombre: 'Liquidaciones', detalle: 'La rendición mensual al propietario' },
  portal: { nombre: 'Portales', detalle: 'Propietario e inquilino ven lo suyo sin llamar' },
  bandeja: { nombre: 'Bandeja de mensajes', detalle: 'WhatsApp, Instagram y mail en un lugar, con tus plantillas' },
  bot: { nombre: 'Respuestas automáticas', detalle: 'El bot que contesta y cuándo llama a una persona' },
  avisos: { nombre: 'Avisos de vencimiento', detalle: 'La bandeja que se genera sola: qué vence y qué aumento toca' },
  red: { nombre: 'La Red', detalle: 'Propiedades entre inmobiliarias, con comisión compartida' },
  documentos: { nombre: 'Documentos', detalle: 'Plantillas de la casa y pre-contratos' },
  emprendimientos: { nombre: 'Emprendimientos', detalle: 'Ventas en pozo, planes de pago y calculadoras' },
  conciliacion: { nombre: 'Conciliación bancaria', detalle: 'El extracto cruzado contra los cobros' },
  actas: { nombre: 'Actas', detalle: 'Estado de la propiedad al entregar y al recibir' },
  multisucursal: { nombre: 'Multi-sucursal', detalle: 'Más de una oficina, con su cartera' },
  api: { nombre: 'API y webhooks', detalle: 'Conectarlo con lo que ya usás' },
  marca_blanca: { nombre: 'Marca blanca', detalle: 'Tu logo en lo que ve el cliente' },
  arca: { nombre: 'ARCA', detalle: 'Facturación electrónica' },
};

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const [e, c] = await Promise.all([
      api<Estado>('/planes/mi-plan'),
      api<Plan[]>('/planes'),
    ]);
    mio.value = e; catalogo.value = c;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar el plan.';
  } finally { cargando.value = false; }
}

function pct(l: Limite): number {
  return l.maximo ? Math.min(100, Math.round((l.usado / l.maximo) * 100)) : 0;
}

/**
 * Las dos familias, cada una con sus planes.
 *
 * No son cinco tamaños del mismo producto: son dos productos. Quien administra
 * veinte departamentos no es una inmobiliaria chica y no va a captar ni a
 * vender nunca; ponerlo como el escalón de abajo de una escalera de
 * inmobiliarias le dice, cada vez que abre esta pantalla, que está en el
 * peldaño más bajo de algo que no quiere subir.
 */
const FAMILIA: Record<string, { titulo: string; bajada: string }> = {
  gestion: {
    titulo: 'Gestión de alquileres',
    bajada: 'Para quien administra alquileres —propios o de terceros— y no trabaja con ventas.',
  },
  inmobiliaria: {
    titulo: 'Inmobiliaria',
    bajada: 'Para quien además capta, vende y tiene equipo.',
  },
};

const familias = computed(() =>
  (['gestion', 'inmobiliaria'] as const)
    .map((f) => ({ clave: f, ...FAMILIA[f], planes: catalogo.value.filter((p) => p.familia === f) }))
    .filter((f) => f.planes.length > 0));

/**
 * Lo que trae ESTE plan y no traía el anterior DE SU FAMILIA.
 *
 * Antes cada columna repetía la lista entera, así que el plan Total mostraba
 * diecisiete renglones y la comparación —que es la única razón por la que
 * alguien mira tres planes juntos— había que hacerla a ojo, cruzando columnas.
 *
 * Mostrando sólo la diferencia, la tabla dice lo que uno vino a preguntar: qué
 * gano si subo.
 */
function nuevosEn(planes: Plan[], i: number): string[] {
  const propios = planes[i]?.modulos ?? [];
  // Contra el anterior de SU familia, no contra el anterior de la lista: el
  // primer plan de Inmobiliaria no es «el siguiente» del último de Gestión.
  if (i === 0) return propios;
  const previos = new Set(planes[i - 1].modulos);
  return propios.filter((m) => !previos.has(m));
}

/** Los topes en una línea, sin los que no aplican. */
function topesDe(p: Plan): string[] {
  const t: string[] = [];
  t.push(`${p.maxUsuarios ?? 'Sin límite de'} usuarios`);
  t.push(`${p.maxPropiedades ? numero(p.maxPropiedades) : 'sin límite de'} propiedades`);
  if (p.maxContratos) t.push(`${p.maxContratos} contratos vigentes`);
  if (p.maxCanales === 0) t.push('sin canales de bandeja');
  else if (p.maxCanales) t.push(`${p.maxCanales} canales`);
  if (p.maxEnviosMes) t.push(`${p.maxEnviosMes} envíos por mes`);
  if (p.maxRedCompartidas) t.push(`${p.maxRedCompartidas} propiedades en la Red`);
  return t;
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Tu plan" />
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <UiSkeleton v-if="cargando" :filas="3" :alto="80" />

    <template v-else-if="mio">
      <section class="card stack">
        <div class="row entre">
          <div>
            <h2 class="text-lg">{{ mio.plan.nombre }}</h2>
            <p v-if="mio.pruebaHasta" class="sub">
              En prueba hasta el {{ fecha(mio.pruebaHasta) }}
            </p>
          </div>
          <StatusChip :texto="mio.estado" :tono="mio.estado === 'activa' ? 'ok' : 'warn'" />
        </div>

        <div class="limites">
          <div v-for="l in mio.limites" :key="l.recurso" class="limite">
            <div class="lim-cab">
              <span>{{ RECURSO[l.recurso] ?? l.recurso }}</span>
              <span class="mono">
                {{ numero(l.usado) }}<template v-if="l.maximo"> / {{ numero(l.maximo) }}</template>
                <template v-else> · sin límite</template>
              </span>
            </div>
            <div v-if="l.maximo" class="barra">
              <div class="lleno" :class="{ tope: !l.permitido, alto: pct(l) >= 80 }"
                   :style="{ width: pct(l) + '%' }" />
            </div>
            <p v-if="!l.permitido" class="tope-aviso">
              Llegaste al tope. Para cargar más hace falta un plan superior.
            </p>
          </div>
        </div>
      </section>

      <!-- Honestidad de producto: el estado real del cobro, sin tarjetas
           inventadas ni "se debitará automáticamente". -->
      <div class="cobro">
        <strong>Cobro</strong>
        <p>{{ mio.cobro.detalle }}</p>
      </div>

      <section v-for="f in familias" :key="f.clave" class="stack">
        <div>
          <h2>{{ f.titulo }}</h2>
          <p class="bajada-familia">{{ f.bajada }}</p>
        </div>
        <div class="grid">
          <article v-for="(p, i) in f.planes" :key="p.codigo" class="card plan"
                   :class="{ actual: p.codigo === mio.plan.codigo }">
            <div class="row entre">
              <h3 class="text-lg">{{ p.nombre }}</h3>
              <StatusChip v-if="p.codigo === mio.plan.codigo" texto="Tu plan" tono="acento" />
            </div>

            <p v-if="p.resumen" class="resumen">{{ p.resumen }}</p>

            <!-- El precio sale de la base. Mientras esté vacío dice «A
                 convenir»: no se publica un número que nadie decidió. -->
            <p class="precio">
              <template v-if="p.precio !== null">USD {{ numero(p.precio) }}<small> por mes</small></template>
              <template v-else>A convenir</template>
            </p>

            <p v-if="p.paraQuien" class="para-quien">{{ p.paraQuien }}</p>

            <ul class="topes">
              <li v-for="t in topesDe(p)" :key="t">{{ t }}</li>
            </ul>

            <!-- Sólo la diferencia con el plan anterior. Repetir la lista
                 entera hacía que el plan de arriba tuviera diecisiete
                 renglones y que comparar fuera trabajo del lector. -->
            <p class="delta-cab">
              <template v-if="i === 0">Incluye</template>
              <template v-else>Todo lo de {{ f.planes[i - 1].nombre }}, más</template>
            </p>
            <ul class="modulos">
              <li v-for="m in nuevosEn(f.planes, i)" :key="m">
                <b>{{ MODULO[m]?.nombre ?? m }}</b>
                <span v-if="MODULO[m]">{{ MODULO[m].detalle }}</span>
              </li>
            </ul>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.row.entre { justify-content: space-between; align-items: flex-start; }
.sub { margin: var(--s-xs) 0 0; color: var(--muted); font-size: 13px; }
.limites { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--s-lg); }
.limite { display: flex; flex-direction: column; gap: var(--s-xs); }
.lim-cab { display: flex; justify-content: space-between; font-size: 13px; color: var(--ink-2); }
.barra { height: 6px; background: var(--surface-3); border-radius: 3px; overflow: hidden; }
.lleno { height: 100%; background: var(--accent); transition: width var(--t-short); }
.lleno.alto { background: var(--warning); }
.lleno.tope { background: var(--danger); }
.tope-aviso { margin: 0; font-size: 12px; color: var(--danger); }
.cobro { padding: var(--s-md) var(--s-lg); background: var(--warning-tint); border: 1px solid var(--warning-line); border-radius: var(--r-md); color: var(--warning); font-size: 13px; }
.cobro p { margin: var(--s-xs) 0 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--s-md); }
.plan.actual { border-color: var(--accent-line); }
.tope-txt { margin: var(--s-xs) 0 0; font-size: 12px; color: var(--muted); }
.precio { margin: var(--s-sm) 0; font-family: var(--font-title); font-size: 20px; color: var(--ink); }
.bajada-familia { margin: var(--s-2xs) 0 0; color: var(--muted); font-size: 13px; }
.plan { display: flex; flex-direction: column; gap: var(--s-sm); }
.resumen { margin: 0; font-size: 13px; color: var(--ink-2); }
.para-quien { margin: 0; font-size: 12px; color: var(--muted); }
.precio small { font-size: 12px; font-family: var(--font-body); color: var(--muted); }

.plan ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.topes { padding-top: var(--s-sm); border-top: 1px solid var(--line); }
.topes li { font-size: 12px; color: var(--muted); }
.delta-cab {
  margin: var(--s-sm) 0 0; font-size: 11px; letter-spacing: .04em;
  text-transform: uppercase; color: var(--muted);
}
.modulos { gap: var(--s-sm); }
.modulos li { display: grid; font-size: 12px; }
.modulos b { font-weight: 600; color: var(--ink-2); }
.modulos span { color: var(--muted); }
</style>
