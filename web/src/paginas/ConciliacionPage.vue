<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useUi } from '../stores/ui';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';
import UiEmpty from '../componentes/UiEmpty.vue';
import UiSkeleton from '../componentes/UiSkeleton.vue';
// `periodo` va con alias: la sugerencia también tiene un campo `periodo`, e
// importarlo con su nombre lo pisaría dentro del template.
import { fecha, money, periodo as mesDe, plural } from '../dominio/formato';

/**
 * La conciliación bancaria: del extracto a los cobros.
 *
 * Donde se va el tiempo de una inmobiliaria no es cargando contratos: es el 1
 * de cada mes, cruzando transferencias con inquilinos leyendo el homebanking
 * en otra pestaña.
 *
 * ── Tres decisiones de esta pantalla ──
 *
 * **Nada se imputa solo, y se ve.** El botón dice «Imputar» al lado de una
 * cuota elegida, no «conciliar todo». Un cobro mal imputado no se descubre el
 * día que pasa: se descubre a fin de mes, cuando la liquidación al propietario
 * sale con el número de otro y ya se pagó.
 *
 * **Cuando el sistema no está seguro, no preselecciona.** Con dos cuotas
 * empatadas —tres inquilinos con el mismo alquiler que vence el mismo día— no
 * hay nada marcado y el aviso lo dice. Elegir por el usuario cuando el sistema
 * no sabe es la forma más rápida de imputarle el alquiler de uno al contrato
 * de otro.
 *
 * **El movimiento se muestra tal como vino del banco.** Descripción,
 * referencia y contraparte sin interpretar: es contra ese texto que la persona
 * decide, y una versión «limpia» le esconde justo la pista que necesita.
 */

interface Cuota {
  id: string; contratoId: string; saldo: number; moneda: string;
  venceEl: string; periodo: string; etiquetaPropiedad: string; inquilino: string;
}
interface Sugerencia {
  cuotaId: string; contratoId: string; puntaje: number; senales: string[];
  motivo: string; exacto: boolean; diferencia: number; cuota: Cuota;
}
interface Movimiento {
  id: string; fecha: string; monto: number; moneda: string;
  descripcion: string; referencia: string | null; contraparte: string | null;
  estado: string; pareceRuido: boolean;
  cruce: { sugerencias: Sugerencia[]; clara: boolean };
}

const ui = useUi();

const movimientos = ref<Movimiento[]>([]);
const cargando = ref(true);
const error = ref('');
const trabajando = ref('');
const importando = ref(false);
/** La cuota elegida para cada movimiento. Vacío = no hay nada elegido. */
const elegida = ref<Record<string, string>>({});

const conSugerencia = computed(() => movimientos.value.filter((m) => m.cruce.sugerencias.length));
const sinSugerencia = computed(() => movimientos.value.filter((m) => !m.cruce.sugerencias.length));

/**
 * Las señales, menos la que ya muestra el chip.
 *
 * Con cinco cuotas empatadas —el caso normal de un inquilino con varios meses
 * impagos— todas dicen «Monto exacto», y repetirlo en el chip y abajo llena la
 * fila de texto idéntico justo donde hay que encontrar la diferencia.
 */
function otrasSenales(s: Sugerencia): string[] {
  return s.exacto ? s.senales.filter((x) => x !== 'Monto exacto') : s.senales;
}

async function cargar() {
  cargando.value = true; error.value = '';
  try {
    movimientos.value = await api<Movimiento[]>('/conciliacion/pendientes');
    // Sólo se preselecciona cuando el sistema está seguro. Ver el comentario
    // de arriba: con empate no se marca nada.
    for (const m of movimientos.value) {
      if (m.cruce.clara) elegida.value[m.id] = m.cruce.sugerencias[0].cuotaId;
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo cargar la conciliación.';
  } finally { cargando.value = false; }
}

async function importar(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const archivo = input.files?.[0];
  if (!archivo) return;

  importando.value = true;
  try {
    const contenido = await archivo.text();
    const r = await api<{
      importados: number; repetidos: number; leidas: number;
      descartadas: Array<{ fila: number; motivo: string }>;
      desde: string | null; hasta: string | null;
    }>('/conciliacion/extractos', {
      method: 'POST',
      body: JSON.stringify({ contenido, nombreArchivo: archivo.name }),
    });

    // Se informan las TRES cosas: lo que entró, lo repetido y lo descartado. Un
    // «listo» a secas deja sin saber si el archivo se leyó entero.
    const partes = [`${plural(r.importados, 'movimiento nuevo', 'movimientos nuevos')}`];
    if (r.repetidos) partes.push(`${r.repetidos} ya estaban`);
    if (r.descartadas.length) {
      partes.push(`${plural(r.descartadas.length, 'fila ilegible', 'filas ilegibles')}`);
    }
    ui.ok('Extracto importado', partes.join(' · '));

    if (r.descartadas.length) {
      error.value =
        `No se pudieron leer ${r.descartadas.length} de las ${r.leidas} filas. ` +
        `La primera: fila ${r.descartadas[0].fila}, ${r.descartadas[0].motivo}`;
    }
    await cargar();
  } catch (e) {
    ui.error('No se pudo importar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally {
    importando.value = false;
    input.value = '';
  }
}

async function imputar(m: Movimiento) {
  const periodoId = elegida.value[m.id];
  if (!periodoId) return;
  const s = m.cruce.sugerencias.find((x) => x.cuotaId === periodoId);

  const ok = await ui.confirmar({
    titulo: '¿Imputar este movimiento?',
    // El PERÍODO va sí o sí. Sin él, con cinco cuotas iguales de la misma
    // persona el cartel dice «la cuota de Camila Rossi» —que es verdad de las
    // cinco— y no confirma nada: es justo el caso en que hace falta confirmar.
    detalle:
      `Se registra un cobro de ${money(m.monto, m.moneda)} en la cuota de ` +
      `${mesDe(s?.cuota.periodo)} de ${s?.cuota.inquilino ?? 'esa cuota'} ` +
      `(${s?.cuota.etiquetaPropiedad}). ` +
      (s && !s.exacto
        ? 'El monto NO coincide con el saldo: la cuota va a quedar parcial o con saldo a favor.'
        : ''),
    confirmar: 'Imputar',
  });
  if (!ok) return;

  trabajando.value = m.id;
  try {
    const r = await api<{ saldo: number; estadoPeriodo: string }>(
      `/conciliacion/movimientos/${m.id}/imputar`,
      { method: 'POST', body: JSON.stringify({ periodoId }) },
    );
    ui.ok('Cobro registrado', `La cuota quedó ${r.estadoPeriodo}.`);
    await cargar();
  } catch (e) {
    ui.error('No se pudo imputar', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally { trabajando.value = ''; }
}

async function ignorar(m: Movimiento) {
  trabajando.value = m.id;
  try {
    await api(`/conciliacion/movimientos/${m.id}/ignorar`, {
      method: 'POST',
      body: JSON.stringify({ motivo: m.pareceRuido ? 'No es un cobro' : undefined }),
    });
    await cargar();
  } catch (e) {
    ui.error('No se pudo', e instanceof ApiError ? e.paraMostrar : 'Error inesperado');
  } finally { trabajando.value = ''; }
}

onMounted(cargar);
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Conciliación"
      bajada="Subís el extracto del banco y el sistema propone a qué cuota va cada transferencia. Imputar lo confirmás vos.">
      <label class="btn" :class="{ ocupado: importando }">
        {{ importando ? 'Leyendo…' : 'Importar extracto' }}
        <input type="file" accept=".csv,text/csv,text/plain" :disabled="importando"
          @change="importar" />
      </label>
    </PageHeader>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <UiSkeleton v-if="cargando" :filas="3" :alto="96" />

    <UiEmpty v-else-if="!movimientos.length"
      titulo="No hay movimientos para revisar"
      detalle="Importá el CSV que baja tu homebanking. Se leen las columnas de fecha, importe, concepto y CUIT o CBU del ordenante; el archivo repetido no se duplica." />

    <template v-else>
      <section v-if="conSugerencia.length" class="stack">
        <h2 class="titulo-grupo">
          {{ plural(conSugerencia.length, 'movimiento con propuesta', 'movimientos con propuesta') }}
        </h2>

        <article v-for="m in conSugerencia" :key="m.id" class="card mov stack">
          <header class="cab">
            <div class="quien">
              <strong class="monto">{{ money(m.monto, m.moneda) }}</strong>
              <span class="crudo">{{ fecha(m.fecha) }} · {{ m.descripcion }}</span>
              <span v-if="m.contraparte" class="crudo mono">De: {{ m.contraparte }}</span>
            </div>
            <StatusChip v-if="!m.cruce.clara" texto="Elegí cuál" tono="warn" />
          </header>

          <p v-if="!m.cruce.clara" class="aviso">
            Hay {{ m.cruce.sugerencias.length }} cuotas que encajan parecido. No se
            preseleccionó ninguna a propósito: elegí vos cuál es.
          </p>

          <ul class="opciones">
            <li v-for="s in m.cruce.sugerencias" :key="s.cuotaId">
              <label class="opcion" :class="{ elegida: elegida[m.id] === s.cuotaId }">
                <input v-model="elegida[m.id]" type="radio" :name="`mov-${m.id}`"
                  :value="s.cuotaId" />
                <span class="datos">
                  <span class="linea1">
                    <strong>{{ mesDe(s.cuota.periodo) }}</strong>
                    <span>{{ s.cuota.inquilino }}</span>
                    <span class="mono cod">{{ s.cuota.etiquetaPropiedad }}</span>
                    <StatusChip v-if="s.exacto" texto="Monto exacto" tono="ok" />
                  </span>
                  <span class="motivo">Vencía el {{ fecha(s.cuota.venceEl) }}</span>
                  <span class="senales">
                    <span v-for="sen in otrasSenales(s)" :key="sen" class="senal">{{ sen }}</span>
                  </span>
                </span>
                <span class="saldo mono">{{ money(s.cuota.saldo, s.cuota.moneda) }}</span>
              </label>
            </li>
          </ul>

          <div class="acciones">
            <button class="btn sm" type="button"
              :disabled="!elegida[m.id] || trabajando === m.id"
              @click="imputar(m)">Imputar</button>
            <button class="btn secondary sm" type="button"
              :disabled="trabajando === m.id" @click="ignorar(m)">No es un cobro</button>
          </div>
        </article>
      </section>

      <section v-if="sinSugerencia.length" class="stack">
        <h2 class="titulo-grupo">
          {{ plural(sinSugerencia.length, 'movimiento sin propuesta', 'movimientos sin propuesta') }}
        </h2>
        <p class="nota">
          No encajan con ninguna cuota pendiente. Suelen ser comisiones, impuestos o
          transferencias propias — y también un pago que todavía no tiene su cuota generada.
        </p>

        <article v-for="m in sinSugerencia" :key="m.id" class="card mov fila">
          <div class="quien">
            <strong class="monto" :class="{ egreso: m.monto < 0 }">
              {{ money(m.monto, m.moneda) }}
            </strong>
            <span class="crudo">{{ fecha(m.fecha) }} · {{ m.descripcion }}</span>
          </div>
          <StatusChip v-if="m.pareceRuido" texto="No parece un cobro" tono="neutro" />
          <button class="btn secondary sm" type="button"
            :disabled="trabajando === m.id" @click="ignorar(m)">Descartar</button>
        </article>
      </section>
    </template>
  </div>
</template>

<style scoped>
.titulo-grupo { margin: 0; font-size: 14px; color: var(--muted); font-weight: 500; }
.nota { margin: 0; font-size: 13px; color: var(--muted); max-width: 76ch; line-height: 1.6; }
.aviso { margin: 0; font-size: 13px; color: var(--warning); }

.mov { gap: var(--s-md); }
.mov.fila { display: flex; align-items: center; gap: var(--s-md); flex-wrap: wrap; }
.cab { display: flex; align-items: flex-start; gap: var(--s-md); }
.quien { display: flex; flex-direction: column; gap: 2px; margin-right: auto; min-width: 0; }
.monto { font-size: 17px; font-variant-numeric: tabular-nums; }
.monto.egreso { color: var(--muted); }
.crudo { font-size: 12px; color: var(--muted); }

.opciones { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-xs); }
.opcion {
  display: flex; align-items: flex-start; gap: var(--s-sm);
  padding: var(--s-sm) var(--s-md); border: 1px solid var(--line);
  border-radius: var(--r-md); cursor: pointer;
}
.opcion:hover { background: var(--surface-2); }
.opcion.elegida { border-color: var(--acento); background: var(--surface-2); }
.opcion input { margin-top: 4px; flex: none; }
.datos { display: flex; flex-direction: column; gap: 2px; margin-right: auto; min-width: 0; }
.linea1 { display: flex; align-items: center; gap: var(--s-sm); flex-wrap: wrap; }
.cod { font-size: 12px; color: var(--muted); }
.motivo { font-size: 12px; color: var(--ink-2); }
.senales { display: flex; gap: var(--s-xs); flex-wrap: wrap; margin-top: 2px; }
.senal { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 0 6px; }
.saldo { flex: none; font-size: 13px; }
.acciones { display: flex; gap: var(--s-sm); }

/* El input de archivo va adentro del botón: un `<input type=file>` no se puede
   estilar y un botón que dispara un input escondido necesita JS de más. */
.btn input[type='file'] { display: none; }
.btn.ocupado { opacity: 0.7; pointer-events: none; }
</style>
