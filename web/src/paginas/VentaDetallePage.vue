<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
import ComisionesOperacion from '../componentes/ComisionesOperacion.vue';
import RepartoComision from '../componentes/RepartoComision.vue';
import { fecha, money } from '../dominio/formato';
import type { LineaComision, TotalesComision } from '../dominio/comisiones';

/**
 * El detalle de una venta.
 *
 * **Esta pantalla no existía.** La fila del listado hacía `router.push` a
 * `/ventas/:id`, ruta que no estaba en el router, así que caía en
 * NoEncontradaPage: se podía abrir una venta, cerrarla y cobrar su comisión por
 * API, y no había forma de mirar de quién era cada peso.
 *
 * Lo que contesta, en este orden: qué se vendió y en cuánto, en qué estado
 * está, **de quién es cada parte de la comisión** —con su memoria de cálculo— y
 * qué se puede hacer ahora.
 */

interface Venta {
  id: string;
  propiedad: { id: string; etiqueta: string; direccion: string };
  comprador: { id: string; nombre: string } | null;
  agenteCaptador: { id: string; nombre: string } | null;
  operacionId: string;
  precioCierre: number;
  moneda: string;
  fechaReserva: string | null;
  fechaBoleto: string | null;
  fechaEscritura: string | null;
  escribania: string | null;
  estado: string;
  comisiones: LineaComision[];
  totales: TotalesComision;
  cuadra: boolean;
  repartida: boolean;
}

const ETIQUETA: Record<string, string> = {
  en_curso: 'En curso', boleto: 'Con boleto', escriturada: 'Escriturada', caida: 'Caída',
};
const TONO: Record<string, 'neutro' | 'warn' | 'ok' | 'err'> = {
  en_curso: 'warn', boleto: 'warn', escriturada: 'ok', caida: 'err',
};

const route = useRoute();
const auth = useAuth();
const ui = useUi();
const id = route.params.id as string;

const v = ref<Venta | null>(null);
const cargando = ref(true);
const error = ref('');
const editando = ref(false);

const puedeEditar = computed(() => auth.rol === 'owner' || auth.rol === 'admin');
const bloqueada = computed(() =>
  (v.value?.comisiones ?? []).some((c) => c.estado === 'cobrada'),
);

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    v.value = await api<Venta>(`/ventas/${id}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la venta.';
  } finally { cargando.value = false; }
}

async function cobrar(comisionId: string) {
  const c = v.value?.comisiones.find((x) => x.id === comisionId);
  const ok = await ui.confirmar({
    titulo: '¿Marcar la comisión como cobrada?',
    detalle: c
      ? `${c.beneficiarioNombre ?? 'La inmobiliaria'} · ${money(c.monto, c.moneda)}. ` +
        'Una vez cobrada, el reparto de esta venta no se puede rehacer.'
      : 'Una vez cobrada, el reparto de esta venta no se puede rehacer.',
    confirmar: 'Marcar cobrada',
  });
  if (!ok) return;

  try {
    await api(`/comisiones/${comisionId}/cobrar`, { method: 'POST', body: '{}' });
    await cargar();
    ui.ok('Comisión cobrada', c ? money(c.monto, c.moneda) : undefined);
  } catch (e) {
    const detalle = e instanceof ApiError ? e.paraMostrar : 'No se pudo marcar como cobrada.';
    error.value = detalle;
    ui.error('No se pudo marcar como cobrada', detalle);
  }
}

async function guardado() {
  editando.value = false;
  await cargar();
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <UiSkeleton v-if="cargando" :filas="3" :alto="80" />

    <template v-else-if="v">
      <PageHeader
        :titulo="v.propiedad.direccion"
        :bajada="`${v.propiedad.etiqueta} · venta`"
      >
        <template #acciones>
          <RouterLink class="btn secondary" :to="`/propiedades/${v.propiedad.id}`">
            Ver la propiedad
          </RouterLink>
        </template>
      </PageHeader>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <div class="resumen card">
        <div>
          <span class="et">Precio de cierre</span>
          <span class="mono grande">{{ money(v.precioCierre, v.moneda) }}</span>
        </div>
        <div>
          <span class="et">Estado</span>
          <StatusChip :texto="ETIQUETA[v.estado] ?? v.estado" :tono="TONO[v.estado] ?? 'neutro'" />
        </div>
        <div><span class="et">Comprador</span><span>{{ v.comprador?.nombre ?? '—' }}</span></div>
        <div>
          <span class="et">Captó</span>
          <RouterLink v-if="v.agenteCaptador" :to="`/equipo/${v.agenteCaptador.id}`">
            {{ v.agenteCaptador.nombre }}
          </RouterLink>
          <!-- Sin captador cargado se dice, no se muestra un guión mudo: es lo
               que explica por qué el reparto no lo pre-llenó. -->
          <span v-else class="falta">sin cargar en la ficha</span>
        </div>
        <div><span class="et">Reserva</span><span class="mono">{{ fecha(v.fechaReserva) }}</span></div>
        <div><span class="et">Boleto</span><span class="mono">{{ fecha(v.fechaBoleto) }}</span></div>
        <div><span class="et">Escritura</span><span class="mono">{{ fecha(v.fechaEscritura) }}</span></div>
        <div><span class="et">Escribanía</span><span>{{ v.escribania ?? '—' }}</span></div>
      </div>

      <section class="card stack">
        <div class="row entre">
          <h2>Comisiones · de quién es cada parte</h2>
          <button
            v-if="puedeEditar && !editando"
            class="btn secondary sm" type="button"
            :disabled="bloqueada"
            :title="bloqueada ? 'Hay una comisión cobrada: no se puede rehacer' : ''"
            @click="editando = true"
          >
            {{ v.repartida ? 'Rehacer el reparto' : 'Repartir la comisión' }}
          </button>
        </div>

        <RepartoComision
          v-if="editando"
          :url-reparto="`/ventas/${v.id}/reparto`"
          :url-sugerido="`/ventas/${v.id}/reparto/sugerido`"
          tipo="venta"
          :bloqueada="bloqueada"
          @guardado="guardado"
          @cancelar="editando = false"
        />

        <ComisionesOperacion
          v-else
          :lineas="v.comisiones"
          :totales="v.totales"
          :moneda="v.moneda"
          :base="v.precioCierre"
          base-etiqueta="Precio de cierre"
          :cuadra="v.cuadra"
          :repartida="v.repartida"
          :puede-cobrar="puedeEditar"
          @cobrar="cobrar"
        />

        <p v-if="!puedeEditar" class="nota">
          El reparto lo arman el titular y administración. Lo ves para saber cómo quedó
          la operación.
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.resumen { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--s-lg); }
.resumen > div { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
.et { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-2); }
.grande { font-size: 20px; color: var(--ink); }
.falta { color: var(--warning-ink); font-size: 12px; }
.nota { margin: 0; font-size: 13px; color: var(--muted); }
</style>
