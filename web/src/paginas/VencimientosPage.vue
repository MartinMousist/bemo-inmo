<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { fecha, moneyCorto, proximidad } from '../dominio/formato';

interface Vencimiento {
  tipo: 'contrato' | 'ajuste' | 'cuota';
  entidadId: string;
  fecha: string;
  etiquetaPropiedad: string;
  referencia: string;
  monto: number | null;
  moneda: string;
  detalle: string | null;
}

const items = ref<Vencimiento[]>([]);
const cargando = ref(true);
const error = ref('');
const dias = ref(90);

const TITULO: Record<string, string> = {
  contrato: 'Vence el contrato',
  ajuste: 'Aumento',
  cuota: 'Cuota impaga',
};

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    items.value = await api<Vencimiento[]>(`/contratos/vencimientos?dias=${dias.value}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.detail : 'No se pudieron cargar los vencimientos.';
  } finally { cargando.value = false; }
}

// Agrupado por urgencia y no por tipo: lo que importa es qué hay que hacer hoy.
const grupos = computed(() => {
  const g: Record<string, Vencimiento[]> = { vencido: [], estaSemana: [], esteMes: [], despues: [] };
  for (const v of items.value) {
    const p = proximidad(v.fecha);
    if (p.tono === 'vencido') g.vencido.push(v);
    else if (p.dias !== null && p.dias <= 7) g.estaSemana.push(v);
    else if (p.dias !== null && p.dias <= 30) g.esteMes.push(v);
    else g.despues.push(v);
  }
  return [
    { clave: 'vencido', titulo: 'Vencido', tono: 'err' as const, items: g.vencido },
    { clave: 'estaSemana', titulo: 'Esta semana', tono: 'err' as const, items: g.estaSemana },
    { clave: 'esteMes', titulo: 'Este mes', tono: 'warn' as const, items: g.esteMes },
    { clave: 'despues', titulo: 'Más adelante', tono: 'neutro' as const, items: g.despues },
  ].filter((x) => x.items.length);
});

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Vencimientos" :bajada="cargando ? '' : `${items.length} en los próximos ${dias} días`">
      <template #acciones>
        <div class="segmented">
          <button v-for="d in [30, 90, 365]" :key="d" type="button"
                  :class="{ activo: dias === d }" @click="dias = d; cargar()">
            {{ d }} d
          </button>
        </div>
      </template>
    </PageHeader>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <UiSkeleton v-if="cargando" :filas="4" :alto="56" />

    <UiEmpty v-else-if="!items.length" titulo="Nada por vencer"
      detalle="Cuando haya contratos, aumentos o cuotas próximas, aparecen acá ordenados por urgencia." />

    <section v-for="g in grupos" v-else :key="g.clave" class="grupo">
      <div class="grupo-cab">
        <h2>{{ g.titulo }}</h2>
        <StatusChip :texto="String(g.items.length)" :tono="g.tono" />
      </div>
      <div class="card sin-padding">
        <ul>
          <li v-for="v in g.items" :key="`${v.tipo}${v.entidadId}`">
            <span class="mono cod">{{ v.etiquetaPropiedad }}</span>
            <div class="que">
              <span class="titulo">{{ TITULO[v.tipo] }}</span>
              <span class="ref">{{ v.referencia }}</span>
            </div>
            <span v-if="v.monto !== null" class="mono monto">{{ moneyCorto(v.monto, v.moneda) }}</span>
            <span v-else class="monto" />
            <span class="mono fecha">{{ fecha(v.fecha) }}</span>
            <StatusChip :texto="proximidad(v.fecha).texto"
              :tono="proximidad(v.fecha).tono === 'vencido' ? 'err' : proximidad(v.fecha).tono === 'err' ? 'err' : proximidad(v.fecha).tono === 'warn' ? 'warn' : 'neutro'" />
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.segmented { display: inline-flex; border: 1px solid var(--line-strong); border-radius: var(--r-md); overflow: hidden; background: var(--surface); }
.segmented button { font: inherit; font-size: 13px; padding: var(--s-sm) var(--s-lg); border: none; border-right: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; }
.segmented button:last-child { border-right: none; }
.segmented button.activo { background: var(--accent-tint); color: var(--accent); font-weight: 500; }
.grupo { display: flex; flex-direction: column; gap: var(--s-sm); }
.grupo-cab { display: flex; align-items: center; gap: var(--s-sm); }
.grupo-cab h2 { font-size: 15px; }
.card.sin-padding { padding: 0; overflow: hidden; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: grid; grid-template-columns: 92px 1fr auto 88px auto; align-items: center; gap: var(--s-md); padding: var(--s-md) var(--s-lg); border-bottom: 1px solid var(--line); font-size: 13px; }
li:last-child { border-bottom: none; }
.cod { color: var(--muted); font-size: 12px; }
.que { display: flex; flex-direction: column; }
.titulo { color: var(--ink); }
.ref { color: var(--muted); font-size: 12px; }
.monto { text-align: right; color: var(--ink); }
.fecha { color: var(--muted); text-align: right; }
.alert { margin: 0; padding: var(--s-sm) var(--s-md); background: var(--danger-tint); border: 1px solid var(--danger-line); border-radius: var(--r-md); color: var(--danger); font-size: 13px; }
@media (max-width: 760px) { li { grid-template-columns: 1fr auto; } .cod, .fecha { display: none; } }
</style>
