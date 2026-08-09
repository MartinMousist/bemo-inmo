<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useAuth } from '../stores/auth';
import { useUi } from '../stores/ui';
import ComisionesOperacion from './ComisionesOperacion.vue';
import RepartoComision from './RepartoComision.vue';
import { money } from '../dominio/formato';
import type { LineaComision, TotalesComision } from '../dominio/comisiones';

/**
 * La comisión del contrato de alquiler: de quién es cada parte.
 *
 * Hasta ahora el sistema no generaba ninguna. `comision.contrato_id` existe
 * desde la migración 008 y **no tenía un solo escritor**: la única fila que
 * había en todo el producto la puso el seed a mano.
 *
 * Dos cosas que este panel dice en voz alta porque si no se malinterpretan:
 *
 * **La base es un mes, y es el monto INICIAL.** No la cuota vigente. Si se
 * calculara contra el monto de hoy, cada ajuste por índice recalcularía una
 * comisión que quizás ya se cobró — el mismo principio del ajuste confirmado
 * inmutable.
 *
 * **No es lo mismo que los honorarios de administración.** Ésta se cobra una
 * vez, al firmar. Los honorarios mensuales se descuentan en la liquidación del
 * propietario y son otro número.
 */

const props = withDefaults(
  defineProps<{
    contratoId: string;
    /** `false` cuando lo envuelve un `BloqueColapsable`: el card y el `<h2>`
     *  los pone él. Default `true`, así nada de lo que ya existía cambia. */
    marco?: boolean;
  }>(),
  { marco: true },
);

/** Marcar cobrada o rehacer el reparto mueve el número de la cabecera. */
const emit = defineEmits<{ cambio: [] }>();

const auth = useAuth();
const ui = useUi();

interface Comisiones {
  contratoId: string;
  base: number;
  moneda: string;
  comisiones: LineaComision[];
  totales: TotalesComision;
  cuadra: boolean;
  repartida: boolean;
  bloqueada: boolean;
}

const c = ref<Comisiones | null>(null);
const cargando = ref(true);
const error = ref('');
const editando = ref(false);

const puedeEditar = computed(() => auth.rol === 'owner' || auth.rol === 'admin');

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    c.value = await api<Comisiones>(`/contratos/${props.contratoId}/comisiones`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la comisión.';
  } finally { cargando.value = false; }
}

async function cobrar(comisionId: string) {
  const l = c.value?.comisiones.find((x) => x.id === comisionId);
  const ok = await ui.confirmar({
    titulo: '¿Marcar la comisión como cobrada?',
    detalle: l
      ? `${l.beneficiarioNombre ?? 'La inmobiliaria'} · ${money(l.monto, l.moneda)}. ` +
        'Una vez cobrada, el reparto de este contrato no se puede rehacer.'
      : 'Una vez cobrada, el reparto de este contrato no se puede rehacer.',
    confirmar: 'Marcar cobrada',
  });
  if (!ok) return;

  try {
    await api(`/comisiones/${comisionId}/cobrar`, { method: 'POST', body: '{}' });
    await cargar();
    emit('cambio');
    ui.ok('Comisión cobrada', l ? money(l.monto, l.moneda) : undefined);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo marcar como cobrada.';
  }
}

async function guardado() {
  editando.value = false;
  await cargar();
  emit('cambio');
}

onMounted(cargar);
</script>

<template>
  <section class="stack" :class="{ card: marco }">
    <div class="row" :class="{ entre: marco }">
      <h2 v-if="marco">Comisión del contrato</h2>
      <button
        v-if="puedeEditar && !editando && !cargando"
        class="btn secondary sm" type="button"
        :disabled="c?.bloqueada"
        :title="c?.bloqueada ? 'Hay una comisión cobrada: no se puede rehacer' : ''"
        @click="editando = true"
      >
        {{ c?.repartida ? 'Rehacer el reparto' : 'Armar la comisión' }}
      </button>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="cargando" class="nota">Cargando…</p>

    <template v-else-if="c">
      <p class="nota">
        Se cobra <strong>una vez, al firmar</strong>, y la base es
        <strong class="mono">{{ money(c.base, c.moneda) }}</strong> — un mes de alquiler,
        el monto inicial del contrato. No se recalcula con los aumentos: una comisión ya
        acordada no cambia porque el alquiler subió.
        Los honorarios de <em>administración</em> son otra cosa y se descuentan mes a mes
        en la liquidación del propietario.
      </p>

      <RepartoComision
        v-if="editando"
        :url-reparto="`/contratos/${c.contratoId}/comisiones`"
        :url-sugerido="`/contratos/${c.contratoId}/comisiones/sugerido`"
        tipo="alquiler"
        :bloqueada="c.bloqueada"
        @guardado="guardado"
        @cancelar="editando = false"
      />

      <ComisionesOperacion
        v-else
        :lineas="c.comisiones"
        :totales="c.totales"
        :moneda="c.moneda"
        :base="c.base"
        base-etiqueta="Un mes de alquiler"
        :cuadra="c.cuadra"
        :repartida="c.repartida"
        :puede-cobrar="puedeEditar"
        @cobrar="cobrar"
      />
    </template>
  </section>
</template>

<style scoped>
.nota { margin: 0; font-size: 13px; color: var(--muted); max-width: 78ch; line-height: 1.6; }
</style>
