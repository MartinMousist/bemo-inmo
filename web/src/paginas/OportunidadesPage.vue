<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import SelectAgente from '../componentes/SelectAgente.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import { ETIQUETA_ESTADO_OPORTUNIDAD, ETIQUETA_ORIGEN, fechaHora, moneyCorto } from '../dominio/formato';
import { filtrosRecordados } from '../dominio/filtros';
import { hayFiltroDeAgente, paramsDeAgente } from '../dominio/agente';
import { consulta } from '../dominio/pagina';
import { useAuth } from '../stores/auth';

interface Oportunidad {
  id: string;
  persona: { nombre: string; telefono: string | null };
  propiedad: { etiqueta: string; direccion: string } | null;
  estado: string; origen: string; interes: string | null;
  presupuestoMin: number | null; presupuestoMax: number | null; moneda: string;
  agenteNombre: string | null;
  visitas: Array<{ id: string; fechaHora: string; estado: string }>;
  creadaEl: string;
}

// El embudo en columnas. Ganada y perdida quedan fuera: no son etapas, son salidas.
const COLUMNAS = ['nueva', 'contactada', 'calificada', 'visita', 'negociacion'] as const;

const items = ref<Oportunidad[]>([]);
const cargando = ref(true);
const error = ref('');
const moviendo = ref<string | null>(null);

const auth = useAuth();

/**
 * Los leads son la EXCEPCIÓN declarada al filtro por agente.
 *
 * En el resto de los listados el filtro es una herramienta y cualquiera ve toda
 * la inmobiliaria. Acá el rol `agente` ve sólo los suyos, por una regla de
 * negocio escrita en `oportunidades.service.ts`: «es la diferencia entre el
 * equipo colabora y cualquiera se lleva la cartera de leads». Abrirla no se
 * revierte con un deploy, así que no se abrió sin que lo pida el dueño.
 *
 * Consecuencia de interfaz: a un asesor NO se le ofrecen los compañeros. Antes,
 * el back le contestaba con una lista vacía —indistinguible de «ese agente no
 * tiene leads»—; hoy es un 403, y el desplegable directamente no está.
 */
const soloPropias = computed(() => auth.rol === 'agente');
const { valores: filtros } = filtrosRecordados('leads', { agente: '' });
const hayFiltro = computed(() => hayFiltroDeAgente(filtros.value.agente));

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    const r = await api<{ items: Oportunidad[] }>(
      `/oportunidades?${consulta(
        { pagina: 1, porPagina: 100 },
        paramsDeAgente(filtros.value.agente, auth.usuario?.id ?? null),
      )}`,
    );
    items.value = r.items;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los leads.';
  } finally { cargando.value = false; }
}

const porColumna = computed(() =>
  COLUMNAS.map((c) => ({ estado: c, items: items.value.filter((o) => o.estado === c) })),
);

const cerradas = computed(() => items.value.filter((o) => o.estado === 'ganada' || o.estado === 'perdida'));

async function avanzar(o: Oportunidad) {
  const i = COLUMNAS.indexOf(o.estado as (typeof COLUMNAS)[number]);
  if (i < 0 || i === COLUMNAS.length - 1) return;
  moviendo.value = o.id;
  try {
    await api(`/oportunidades/${o.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: COLUMNAS[i + 1] }),
    });
    await cargar();
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo mover.';
  } finally { moviendo.value = null; }
}

watch(filtros, () => void cargar(), { deep: true });

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Leads" :bajada="cargando ? '' : `${items.length} en seguimiento`">
      <template #acciones>
        <RouterLink class="btn" to="/leads/nueva">Nuevo lead</RouterLink>
      </template>
    </PageHeader>

    <div class="filtros">
      <SelectAgente v-model="filtros.agente" :solo-propias="soloPropias" />
      <p v-if="soloPropias" class="nota-rol">
        Tu rol ve solamente sus propios leads. El resto de los listados
        —propiedades, cartera, ventas y avisos— los ves enteros.
      </p>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <UiSkeleton v-if="cargando" :filas="3" :alto="120" />

    <UiEmpty
      v-else-if="!items.length && hayFiltro"
      titulo="Ningún lead de esa persona"
      detalle="Sacá el filtro para ver los de toda la inmobiliaria."
    >
      <button class="btn secondary" type="button" @click="filtros.agente = ''">
        Quitar el filtro
      </button>
    </UiEmpty>

    <UiEmpty
      v-else-if="!items.length"
      titulo="Todavía no hay leads"
      detalle="Cada consulta que entra por portal, WhatsApp o teléfono se registra acá y no se pierde."
    >
      <RouterLink class="btn" to="/leads/nueva">Registrar el primero</RouterLink>
    </UiEmpty>

    <template v-else>
      <div class="tablero">
        <section v-for="col in porColumna" :key="col.estado" class="columna">
          <header>
            <span>{{ ETIQUETA_ESTADO_OPORTUNIDAD[col.estado] }}</span>
            <span class="conteo mono">{{ col.items.length }}</span>
          </header>
          <div class="cards">
            <article v-for="o in col.items" :key="o.id" class="tarjeta">
              <p class="nombre">{{ o.persona.nombre }}</p>
              <p v-if="o.propiedad" class="prop mono">{{ o.propiedad.etiqueta }}</p>
              <p v-else-if="o.presupuestoMax" class="prop mono">
                hasta {{ moneyCorto(o.presupuestoMax, o.moneda) }}
              </p>
              <!-- `agenteNombre` venía en la respuesta desde el primer día y no
                   se mostraba: la misma trampa que `tipoOperacion` en avisos. Sin
                   él, filtrar por una persona era confiar a ciegas. -->
              <p v-if="o.agenteNombre" class="agente">{{ o.agenteNombre }}</p>
              <div class="meta">
                <StatusChip :texto="ETIQUETA_ORIGEN[o.origen] ?? o.origen" />
                <span v-if="o.visitas.length" class="visita">
                  {{ fechaHora(o.visitas[0].fechaHora) }}
                </span>
              </div>
              <button
                v-if="col.estado !== 'negociacion'"
                class="avanzar"
                type="button"
                :disabled="moviendo === o.id"
                @click="avanzar(o)"
              >
                Avanzar →
              </button>
            </article>
            <p v-if="!col.items.length" class="vacia">—</p>
          </div>
        </section>
      </div>

      <details v-if="cerradas.length" class="cerradas">
        <summary>{{ cerradas.length }} cerradas</summary>
        <ul>
          <li v-for="o in cerradas" :key="o.id">
            <StatusChip
              :texto="ETIQUETA_ESTADO_OPORTUNIDAD[o.estado]"
              :tono="o.estado === 'ganada' ? 'ok' : 'err'"
            />
            <span>{{ o.persona.nombre }}</span>
          </li>
        </ul>
      </details>
    </template>
  </div>
</template>

<style scoped>
.tablero {
  display: grid;
  grid-template-columns: repeat(5, minmax(180px, 1fr));
  gap: var(--s-md);
  overflow-x: auto;
  padding-bottom: var(--s-sm);
}
.columna {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: var(--s-md);
  min-width: 180px;
}
.columna header {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--muted); margin-bottom: var(--s-md);
}
.conteo { color: var(--muted-2); }
.cards { display: flex; flex-direction: column; gap: var(--s-sm); }
.tarjeta {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--s-md);
  display: flex; flex-direction: column; gap: var(--s-xs);
}
.nombre { margin: 0; color: var(--ink); font-weight: 500; font-size: 13px; }
.prop { margin: 0; font-size: 11px; color: var(--muted); }
.agente { margin: 0; font-size: 11px; color: var(--muted-2); }
.nota-rol { margin: 0; font-size: 12px; color: var(--muted); max-width: 60ch; }
.meta { display: flex; gap: var(--s-xs); align-items: center; flex-wrap: wrap; }
.visita { font-size: 11px; color: var(--accent); }
.avanzar {
  margin-top: var(--s-xs); align-self: flex-start;
  font: inherit; font-size: 11px; padding: 2px 6px;
  border: 1px solid var(--line-strong); border-radius: var(--r-sm);
  background: transparent; color: var(--muted); cursor: pointer;
}
.avanzar:hover { color: var(--accent); border-color: var(--accent-line); }
.avanzar:disabled { opacity: 0.5; cursor: default; }
.vacia { margin: 0; color: var(--muted-2); text-align: center; font-size: 12px; padding: var(--s-md); }
.cerradas { font-size: 13px; color: var(--muted); }
.cerradas summary { cursor: pointer; }
.cerradas ul { list-style: none; padding: var(--s-md) 0 0; margin: 0; display: flex; flex-direction: column; gap: var(--s-sm); }
.cerradas li { display: flex; gap: var(--s-sm); align-items: center; }
</style>
