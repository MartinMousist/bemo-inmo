<script setup lang="ts">
import { onMounted, ref } from 'vue';
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
  codigo: string; nombre: string; maxUsuarios: number | null;
  maxPropiedades: number | null; modulos: string[]; precio: number | null;
}

const mio = ref<Estado | null>(null);
const catalogo = ref<Plan[]>([]);
const cargando = ref(true);
const error = ref('');

const RECURSO: Record<string, string> = { usuarios: 'Usuarios', propiedades: 'Propiedades' };
const MODULO: Record<string, string> = {
  propiedades: 'Cartera', personas: 'Personas', oportunidades: 'Oportunidades',
  contratos: 'Contratos', ajustes: 'Ajustes por índice', cobranzas: 'Cobranzas',
  liquidaciones: 'Liquidaciones', plantillas: 'Plantillas', comisiones: 'Comisiones',
  recordatorios: 'Recordatorios', multisucursal: 'Multi-sucursal',
  campanias: 'Campañas', api: 'API pública', marca_blanca: 'Marca blanca',
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
    error.value = e instanceof ApiError ? e.detail : 'No se pudo cargar el plan.';
  } finally { cargando.value = false; }
}

function pct(l: Limite): number {
  return l.maximo ? Math.min(100, Math.round((l.usado / l.maximo) * 100)) : 0;
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
            <h2>{{ mio.plan.nombre }}</h2>
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

      <section class="stack">
        <h2>Los planes</h2>
        <div class="grid">
          <article v-for="p in catalogo" :key="p.codigo" class="card plan"
                   :class="{ actual: p.codigo === mio.plan.codigo }">
            <div class="row entre">
              <h3>{{ p.nombre }}</h3>
              <StatusChip v-if="p.codigo === mio.plan.codigo" texto="Tu plan" tono="acento" />
            </div>
            <p class="tope-txt mono">
              {{ p.maxUsuarios ?? '∞' }} usuarios · {{ p.maxPropiedades ?? '∞' }} propiedades
            </p>
            <p class="precio">A convenir</p>
            <ul>
              <li v-for="m in p.modulos" :key="m">{{ MODULO[m] ?? m }}</li>
            </ul>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
h2 { font-size: 17px; }
h3 { font-size: 16px; }
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
.plan ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.plan li { font-size: 12px; color: var(--muted); }
.alert { margin: 0; padding: var(--s-sm) var(--s-md); background: var(--danger-tint); border: 1px solid var(--danger-line); border-radius: var(--r-md); color: var(--danger); font-size: 13px; }
</style>
