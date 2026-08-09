<script setup lang="ts">
import { computed } from 'vue';
import StatusChip from './StatusChip.vue';
import { fecha, money } from '../dominio/formato';
import {
  agruparPorPunta,
  ETIQUETA_ESTADO,
  TONO_ESTADO,
  type LineaComision,
  type TotalesComision,
} from '../dominio/comisiones';

/**
 * De quién es cada peso de esta operación.
 *
 * Es la pregunta que se hace en el mostrador el día 5 de cada mes y que hasta
 * hoy se contestaba con una planilla aparte. La pantalla la contesta en un
 * árbol por punta, porque así es como se cobra: cada punta se factura, después
 * se comparte con la otra agencia si la hubo, y recién de lo que queda cobran
 * los agentes y la casa.
 *
 * Tres cosas que este componente hace y son decisiones, no estética:
 *
 * **Cada línea lleva su memoria de cálculo.** `USD 4.860 × 25 % = USD 1.215`.
 * Es la regla del dominio: un número que el usuario no le puede explicar a la
 * otra parte no sirve. La arma el motor, no la pantalla.
 *
 * **Un agente que capta y cierra son DOS líneas.** Sumarlas en una escondería
 * que cobra por dos conceptos distintos, que es justo lo que se discute.
 *
 * **Si no cuadra, lo dice.** El total de la operación tiene que ser exactamente
 * lo que se reparte. Diez de las once ventas de demostración lo violaban y en
 * pantalla no se notaba, porque cada número se veía razonable por separado.
 */

const props = defineProps<{
  lineas: LineaComision[];
  totales: TotalesComision;
  moneda: string;
  /** El precio de cierre o el mes de alquiler: la base de todo el cálculo. */
  base: number;
  baseEtiqueta: string;
  cuadra: boolean;
  repartida: boolean;
  puedeCobrar?: boolean;
}>();

const emit = defineEmits<{ (e: 'cobrar', comisionId: string): void }>();

const grupos = computed(() => agruparPorPunta(props.lineas));

const diferencia = computed(() =>
  redondear(
    props.totales.externas + props.totales.agentes + props.totales.casa -
      props.totales.operacion,
  ),
);

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function quien(l: LineaComision): string {
  if (l.beneficiarioTipo === 'operacion') return 'La operación';
  if (l.beneficiarioTipo === 'casa') return 'La inmobiliaria';
  return l.beneficiarioNombre ?? '—';
}
</script>

<template>
  <div class="stack">
    <div v-if="!lineas.length" class="vacio">
      <p><strong>Sin comisiones todavía.</strong></p>
      <p>
        El reparto no está hecho. Se arma con los honorarios de cada punta, con quién
        se comparte la operación si hay otra inmobiliaria, y quién captó y quién cerró.
      </p>
    </div>

    <template v-else>
      <p v-if="!cuadra" class="alert" role="alert">
        Este reparto <strong>no cuadra</strong>: la operación factura
        {{ money(totales.operacion, moneda) }} y lo repartido suma
        {{ money(totales.operacion + diferencia, moneda) }}
        ({{ diferencia > 0 ? 'sobran' : 'faltan' }}
        {{ money(Math.abs(diferencia), moneda) }}).
        Rehacé el reparto para que la plata cierre.
      </p>

      <p v-else-if="!repartida" class="aviso" role="status">
        Están cargados los honorarios de la operación, pero
        <strong>todavía no se repartieron</strong>: no hay agente ni inmobiliaria con
        una parte asignada.
      </p>

      <div class="totales">
        <div>
          <span class="et">{{ baseEtiqueta }}</span>
          <span class="mono">{{ money(base, moneda) }}</span>
        </div>
        <div>
          <span class="et">Factura la operación</span>
          <span class="mono grande">{{ money(totales.operacion, moneda) }}</span>
        </div>
        <div v-if="totales.externas > 0">
          <span class="et">A otra inmobiliaria</span>
          <span class="mono">{{ money(totales.externas, moneda) }}</span>
        </div>
        <div>
          <span class="et">A los agentes</span>
          <span class="mono">{{ money(totales.agentes, moneda) }}</span>
        </div>
        <div>
          <span class="et">Queda en la casa</span>
          <span class="mono">{{ money(totales.casa, moneda) }}</span>
        </div>
      </div>

      <section v-for="g in grupos" :key="g.punta" class="punta">
        <header v-if="g.cabecera" class="punta-cab">
          <span class="punta-nombre">{{ g.etiqueta }}</span>
          <span class="mono punta-monto">{{ money(g.cabecera.monto, g.cabecera.moneda) }}</span>
          <StatusChip
            :texto="ETIQUETA_ESTADO[g.cabecera.estado] ?? g.cabecera.estado"
            :tono="TONO_ESTADO[g.cabecera.estado] ?? 'neutro'" />
          <span class="memoria mono">{{ g.cabecera.memoria }}</span>
        </header>

        <ul class="lineas">
          <li v-for="l in g.hijas" :key="l.id" :class="{ anulada: l.estado === 'anulada' }">
            <div class="linea-cab">
              <span class="rol" :data-tipo="l.beneficiarioTipo">{{ quien(l) }}</span>
              <span class="concepto">{{ l.concepto }}</span>
              <span class="mono monto">{{ money(l.monto, l.moneda) }}</span>
              <StatusChip
                :texto="ETIQUETA_ESTADO[l.estado] ?? l.estado"
                :tono="TONO_ESTADO[l.estado] ?? 'neutro'" />
              <span v-if="l.cobradaEl" class="cuando">cobrada el {{ fecha(l.cobradaEl) }}</span>
              <button
                v-if="puedeCobrar && (l.estado === 'proyectada' || l.estado === 'devengada')
                      && l.beneficiarioTipo !== 'operacion'"
                class="btn secondary sm"
                type="button"
                @click="emit('cobrar', l.id)"
              >
                Marcar cobrada
              </button>
            </div>
            <p class="memoria mono">{{ l.memoria }}</p>
          </li>
          <li v-if="!g.hijas.length" class="sin-repartir">
            Esta punta todavía no se repartió.
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.vacio { color: var(--muted); font-size: 13px; line-height: 1.6; }
.vacio p { margin: 0 0 var(--s-xs); max-width: 70ch; }
.aviso {
  margin: 0; padding: var(--s-sm) var(--s-md);
  background: var(--surface-2); border: 1px solid var(--line);
  border-radius: var(--r-md); color: var(--ink-2); font-size: 13px;
}
.totales {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--s-lg); padding: var(--s-md) 0; border-bottom: 1px solid var(--line);
}
.totales > div { display: flex; flex-direction: column; gap: 2px; }
.et { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-2); }
.grande { font-size: 18px; color: var(--ink); }
.punta { display: flex; flex-direction: column; gap: var(--s-sm); }
.punta-cab {
  display: flex; align-items: center; gap: var(--s-md); flex-wrap: wrap;
  padding-bottom: var(--s-xs); border-bottom: 1px solid var(--line);
}
.punta-nombre { font-weight: 600; color: var(--ink); }
.punta-monto { color: var(--ink); font-size: 14px; }
.lineas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-sm); }
.lineas li { padding: var(--s-sm) var(--s-md); background: var(--surface-2); border-radius: var(--r-md); }
.linea-cab { display: flex; align-items: center; gap: var(--s-sm); flex-wrap: wrap; }
.rol { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.rol[data-tipo='agente'] { color: var(--accent-ink); }
.rol[data-tipo='inmobiliaria_externa'] { color: var(--warning-ink); }
.concepto { color: var(--ink-2); font-size: 13px; flex: 1; min-width: 140px; }
.monto { color: var(--ink); font-size: 14px; }
.cuando { font-size: 11px; color: var(--muted-2); }
.memoria { font-size: 11px; color: var(--muted); margin: var(--s-2xs) 0 0; }
.anulada { opacity: 0.55; }
.anulada .monto { text-decoration: line-through; }
.sin-repartir { color: var(--muted-2); font-size: 12px; background: none !important; padding-left: 0 !important; }

@media (max-width: 640px) {
  .concepto { flex-basis: 100%; }
}
</style>
