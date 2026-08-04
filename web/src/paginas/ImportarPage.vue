<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, ApiError, descargar } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import StatusChip from '../componentes/StatusChip.vue';

interface Problema { fila: number; campo?: string; mensaje: string; grave: boolean }
interface Previsualizacion {
  totalFilas: number; aImportar: number; aOmitir: number;
  columnasReconocidas: string[]; columnasIgnoradas: string[];
  problemas: Problema[]; muestra: Array<Record<string, unknown>>;
}

const recurso = ref<'personas' | 'propiedades'>('propiedades');
const csv = ref('');
const nombreArchivo = ref('');
const prev = ref<Previsualizacion | null>(null);
const resultado = ref<{ importadas: number; omitidas: number; problemas: Problema[] } | null>(null);
const cargando = ref(false);
const error = ref('');

const graves = computed(() => prev.value?.problemas.filter((p) => p.grave) ?? []);
const avisos = computed(() => prev.value?.problemas.filter((p) => !p.grave) ?? []);

function leerArchivo(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  nombreArchivo.value = f.name;
  prev.value = null; resultado.value = null; error.value = '';
  const lector = new FileReader();
  lector.onload = () => { csv.value = String(lector.result ?? ''); previsualizar(); };
  // UTF-8: si el archivo viene en Latin-1 los acentos se ven mal, y es mejor
  // que se note en la previsualización que después de importar 400 filas.
  lector.readAsText(f, 'utf-8');
}

async function previsualizar() {
  if (!csv.value.trim()) return;
  cargando.value = true; error.value = ''; resultado.value = null;
  try {
    prev.value = await api<Previsualizacion>('/importar/previsualizar', {
      method: 'POST',
      body: JSON.stringify({ recurso: recurso.value, csv: csv.value }),
    });
  } catch (e) {
    error.value = e instanceof ApiError ? e.detail : 'No se pudo leer el archivo.';
    prev.value = null;
  } finally { cargando.value = false; }
}

async function importar() {
  cargando.value = true; error.value = '';
  try {
    resultado.value = await api('/importar', {
      method: 'POST',
      body: JSON.stringify({ recurso: recurso.value, csv: csv.value }),
    });
    prev.value = null; csv.value = ''; nombreArchivo.value = '';
  } catch (e) {
    error.value = e instanceof ApiError ? e.detail : 'No se pudo importar.';
  } finally { cargando.value = false; }
}

async function bajarModelo() {
  error.value = '';
  try { await descargar(`/importar/plantilla/${recurso.value}.csv`); }
  catch (e) { error.value = e instanceof ApiError ? e.detail : 'No se pudo bajar el modelo.'; }
}

function columnas(o: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '');
}
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Importar"
      bajada="Traé tu cartera desde una planilla. Primero se muestra qué va a pasar; recién después se confirma." />

    <section class="card stack">
      <div class="row">
        <div class="segmented">
          <button v-for="r in (['propiedades', 'personas'] as const)" :key="r" type="button"
                  :class="{ activo: recurso === r }"
                  @click="recurso = r; prev = null; resultado = null">
            {{ r === 'propiedades' ? 'Propiedades' : 'Personas' }}
          </button>
        </div>
        <button class="btn secondary sm" type="button" @click="bajarModelo">
          Bajar el modelo
        </button>
      </div>

      <label class="archivo">
        <input type="file" accept=".csv,text/csv" @change="leerArchivo" />
        <span>{{ nombreArchivo || 'Elegí un archivo CSV…' }}</span>
      </label>

      <p class="nota">
        Sirve lo que exporta Excel. Reconoce columnas escritas de distintas formas
        («Sup. Total», «superficie», «m2») y números como «1.234,56» o «$ 485.000».
      </p>
    </section>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <template v-if="prev">
      <section class="card stack">
        <div class="row entre">
          <h2>Qué va a pasar</h2>
          <div class="row">
            <StatusChip :texto="`${prev.aImportar} se importan`" tono="ok" />
            <StatusChip v-if="prev.aOmitir" :texto="`${prev.aOmitir} se omiten`" tono="err" />
          </div>
        </div>

        <p class="cols">
          Reconocidas: <strong>{{ prev.columnasReconocidas.join(', ') || '—' }}</strong>
          <template v-if="prev.columnasIgnoradas.length">
            <br />Ignoradas: <span class="muted">{{ prev.columnasIgnoradas.join(', ') }}</span>
          </template>
        </p>

        <div v-if="prev.muestra.length" class="muestra">
          <p class="mini">Primeras filas, como van a quedar</p>
          <div v-for="(m, i) in prev.muestra" :key="i" class="fila-muestra">
            <span v-for="[k, v] in columnas(m)" :key="k" class="dato">
              <em>{{ k }}</em> {{ v }}
            </span>
          </div>
        </div>

        <div v-if="graves.length" class="problemas err">
          <p><strong>{{ graves.length }} fila(s) no se van a importar</strong></p>
          <ul>
            <li v-for="(p, i) in graves.slice(0, 12)" :key="i">
              Fila {{ p.fila }}: {{ p.mensaje }}
            </li>
          </ul>
          <p v-if="graves.length > 12" class="mini">y {{ graves.length - 12 }} más…</p>
        </div>

        <div v-if="avisos.length" class="problemas warn">
          <p><strong>{{ avisos.length }} aviso(s)</strong> — se importan igual</p>
          <ul>
            <li v-for="(p, i) in avisos.slice(0, 8)" :key="i">
              Fila {{ p.fila }}: {{ p.mensaje }}
            </li>
          </ul>
        </div>

        <div class="row">
          <button class="btn" type="button" :disabled="cargando || !prev.aImportar" @click="importar">
            {{ cargando ? 'Importando…' : `Importar ${prev.aImportar} fila(s)` }}
          </button>
          <button class="btn secondary" type="button" @click="prev = null; csv = ''; nombreArchivo = ''">
            Cancelar
          </button>
        </div>
      </section>
    </template>

    <section v-if="resultado" class="card stack">
      <h2>Listo</h2>
      <p>
        Se importaron <strong>{{ resultado.importadas }}</strong> fila(s).
        <template v-if="resultado.omitidas">Se omitieron {{ resultado.omitidas }}.</template>
      </p>
      <div v-if="resultado.problemas.length" class="problemas err">
        <ul>
          <li v-for="(p, i) in resultado.problemas.slice(0, 20)" :key="i">
            Fila {{ p.fila }}: {{ p.mensaje }}
          </li>
        </ul>
      </div>
      <RouterLink class="btn" :to="recurso === 'personas' ? '/personas' : '/propiedades'">
        Ver lo importado
      </RouterLink>
    </section>
  </div>
</template>

<style scoped>
h2 { font-size: 15px; }
.row.entre { justify-content: space-between; }
.segmented { display: inline-flex; border: 1px solid var(--line-strong); border-radius: var(--r-md); overflow: hidden; background: var(--surface); }
.segmented button { font: inherit; font-size: 13px; padding: var(--s-sm) var(--s-lg); border: none; border-right: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; }
.segmented button:last-child { border-right: none; }
.segmented button.activo { background: var(--accent-tint); color: var(--accent); font-weight: 500; }
.btn.sm { padding: 4px var(--s-md); font-size: 12px; text-decoration: none; }
.archivo { display: block; padding: var(--s-xl); border: 1px dashed var(--line-strong); border-radius: var(--r-md); text-align: center; cursor: pointer; color: var(--muted); }
.archivo:hover { border-color: var(--accent-line); color: var(--ink-2); }
.archivo input { display: none; }
.nota { margin: 0; font-size: 12px; color: var(--muted-2); }
.cols { margin: 0; font-size: 12px; color: var(--ink-2); line-height: 1.7; }
.muted { color: var(--muted-2); }
.mini { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted-2); }
.muestra { display: flex; flex-direction: column; gap: var(--s-sm); }
.fila-muestra { display: flex; flex-wrap: wrap; gap: var(--s-md); padding: var(--s-sm) var(--s-md); background: var(--surface-2); border-radius: var(--r-sm); font-size: 12px; }
.dato em { font-style: normal; color: var(--muted-2); margin-right: 4px; }
.problemas { padding: var(--s-md); border-radius: var(--r-md); font-size: 13px; }
.problemas.err { background: var(--danger-tint); border: 1px solid var(--danger-line); color: var(--danger); }
.problemas.warn { background: var(--warning-tint); border: 1px solid var(--warning-line); color: var(--warning); }
.problemas p { margin: 0 0 var(--s-xs); }
.problemas ul { margin: 0; padding-left: var(--s-lg); }
.btn:disabled { opacity: .6; cursor: default; }
.alert { margin: 0; padding: var(--s-sm) var(--s-md); background: var(--danger-tint); border: 1px solid var(--danger-line); border-radius: var(--r-md); color: var(--danger); font-size: 13px; }
</style>
