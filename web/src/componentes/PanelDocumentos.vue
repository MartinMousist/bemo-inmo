<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api/cliente';
import { useUi } from '../stores/ui';
import { plural } from '../dominio/formato';

/**
 * El pre-contrato de ESTE contrato.
 *
 * El motor estaba construido —`POST /v1/plantillas/:id/generar` arma el
 * documento con las partes, los montos, el plazo y el índice reales— y no había
 * forma de llegar a él desde ninguna pantalla. Acá es un botón.
 *
 * Dos cosas que la pantalla tiene que decir y que un «Generar» pelado no dice:
 *
 * **Qué variables quedaron sin dato.** En un pre-contrato tener huecos es
 * normal —hay cláusulas que se completan a mano— pero hay que verlos antes de
 * imprimir, no después de que el inquilino los encuentre.
 *
 * **Que esto no firma nada.** El sistema genera el documento; la firma pasa
 * afuera. Está en el spec §1 («no es un firmador digital») y la pantalla lo
 * repite en vez de dar a entender otra cosa con un botón que dice «Generar
 * contrato».
 */

interface Plantilla { id: string; tipo: string; nombre: string }
interface Documento {
  texto: string;
  faltantes: string[];
  plantilla: { id: string; nombre: string };
  advertencia?: string;
}

const props = defineProps<{ contratoId: string; etiqueta: string }>();

const ui = useUi();
const plantillas = ref<Plantilla[]>([]);
const elegida = ref('');
const doc = ref<Documento | null>(null);
const generando = ref(false);
const error = ref('');

/**
 * Sólo las que tienen sentido para un contrato.
 *
 * El recibo se genera desde un cobro y la liquidación desde una liquidación:
 * ofrecerlas acá sería ofrecer algo que va a fallar, y un control que no va a
 * funcionar es peor que la ausencia del control.
 */
const utiles = computed(() =>
  plantillas.value.filter((p) =>
    ['pre_contrato_alquiler', 'pre_contrato_venta', 'reserva',
     'aviso_aumento', 'aviso_vencimiento', 'otro'].includes(p.tipo),
  ),
);

onMounted(async () => {
  try {
    plantillas.value = await api<Plantilla[]>('/plantillas');
    // La de pre-contrato de alquiler viene elegida: es la que se usa el 90% de
    // las veces desde acá.
    elegida.value = utiles.value.find((p) => p.tipo === 'pre_contrato_alquiler')?.id
      ?? utiles.value[0]?.id
      ?? '';
  } catch {
    plantillas.value = [];
  }
});

async function generar() {
  if (!elegida.value) return;
  generando.value = true;
  error.value = '';
  try {
    doc.value = await api<Documento>(`/plantillas/${elegida.value}/generar`, {
      method: 'POST',
      body: JSON.stringify({ contratoId: props.contratoId }),
    });
  } catch (e) {
    doc.value = null;
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo generar el documento.';
  } finally {
    generando.value = false;
  }
}

async function copiar() {
  if (!doc.value) return;
  try {
    await navigator.clipboard.writeText(doc.value.texto);
    ui.ok('Copiado', 'Pegalo en el procesador de texto para imprimirlo.');
  } catch {
    ui.error('No se pudo copiar', 'Seleccioná el texto y copialo a mano.');
  }
}

/** Descarga como `.txt`: el navegador no necesita ninguna librería para esto. */
function descargar() {
  if (!doc.value) return;
  const blob = new Blob([doc.value.texto], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${props.etiqueta}-${doc.value.plantilla.nombre}`
    .replace(/[^\w\-.]+/g, '-')
    .toLowerCase() + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}
</script>

<template>
  <section class="card stack">
    <header class="cab">
      <h2>Pre-contrato y avisos</h2>
    </header>

    <p v-if="!plantillas.length" class="ayuda">
      No hay plantillas cargadas todavía.
      <RouterLink to="/plantillas">Traer las base</RouterLink> y volver acá.
    </p>

    <template v-else>
      <div class="barra">
        <label class="campo suave crece">
          <span>Documento</span>
          <select v-model="elegida">
            <option v-for="p in utiles" :key="p.id" :value="p.id">{{ p.nombre }}</option>
          </select>
        </label>
        <button class="btn" type="button" :disabled="generando || !elegida" @click="generar">
          {{ generando ? 'Generando…' : 'Generar' }}
        </button>
      </div>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <template v-if="doc">
        <p v-if="doc.advertencia" class="alert aviso">{{ doc.advertencia }}</p>

        <p v-if="doc.faltantes.length" class="alert aviso">
          {{ plural(doc.faltantes.length, 'variable sin dato', 'variables sin dato') }}:
          <code v-for="f in doc.faltantes" :key="f" class="mono">{{ f }}</code>.
          Puede ser normal —hay cláusulas que se completan a mano— pero conviene
          mirarlas antes de imprimir.
        </p>

        <pre class="mono salida">{{ doc.texto }}</pre>

        <div class="pie">
          <!-- Lo que el sistema hace termina acá: el documento sale, la firma
               pasa afuera. Ver spec §1. -->
          <span class="nota">El documento sale de acá; la firma se hace afuera.</span>
          <button class="btn secondary sm" type="button" @click="copiar">Copiar</button>
          <button class="btn secondary sm" type="button" @click="descargar">Descargar</button>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.cab { display: flex; align-items: center; justify-content: space-between; gap: var(--s-md); }
.cab h2 { margin: 0; }
.barra { display: flex; align-items: flex-end; gap: var(--s-md); flex-wrap: wrap; }
.barra .crece { flex: 1 1 220px; }
.ayuda { margin: 0; font-size: 13px; color: var(--muted); }

.salida {
  margin: 0;
  padding: var(--s-md);
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-x: auto;
  max-height: 420px;
  overflow-y: auto;
  color: var(--ink-2);
}

.pie { display: flex; align-items: center; justify-content: flex-end; gap: var(--s-sm); flex-wrap: wrap; }
.nota { margin-right: auto; font-size: 12px; color: var(--muted); }
</style>
