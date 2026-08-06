<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';

const router = useRouter();
const propiedades = ref<Array<{ id: string; etiqueta: string; direccion: string }>>([]);
const personas = ref<Array<{ id: string; nombreCompleto: string }>>([]);
const error = ref('');
const guardando = ref(false);

const f = reactive({
  propiedadId: '', fechaInicio: '', fechaFin: '',
  montoInicial: '', moneda: 'ARS', diaVencimiento: '10',
  indice: 'ipc', indicePorcentaje: '', periodicidadMeses: '3', mesBase: '',
  honorariosPct: '10', administrado: true,
  locatarioId: '', deposito: '',
});

onMounted(async () => {
  try {
    const [p, pe] = await Promise.all([
      api<{ items: typeof propiedades.value }>('/propiedades?porPagina=100'),
      api<{ items: typeof personas.value }>('/personas?porPagina=100'),
    ]);
    propiedades.value = p.items; personas.value = pe.items;
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudieron cargar los datos.';
  }
});

function num(v: string): number | undefined {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? undefined : n;
}

async function guardar() {
  error.value = ''; guardando.value = true;
  try {
    const r = await api<{ id: string }>('/contratos', {
      method: 'POST',
      body: JSON.stringify({
        propiedadId: f.propiedadId,
        fechaInicio: f.fechaInicio,
        fechaFin: f.fechaFin,
        diaVencimiento: num(f.diaVencimiento),
        montoInicial: num(f.montoInicial),
        moneda: f.moneda,
        indice: f.indice,
        indicePorcentaje: f.indice === 'porcentaje_fijo' ? num(f.indicePorcentaje) : undefined,
        periodicidadMeses: f.indice === 'ninguno' ? undefined : num(f.periodicidadMeses),
        mesBase: f.mesBase ? `${f.mesBase}-01` : undefined,
        honorariosPct: num(f.honorariosPct),
        administrado: f.administrado,
        deposito: num(f.deposito),
        locatarios: f.locatarioId ? [f.locatarioId] : undefined,
      }),
    });
    router.replace(`/contratos/${r.id}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo guardar.';
  } finally { guardando.value = false; }
}
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Nuevo contrato"
      bajada="Cada contrato lleva su índice y su periodicidad: desde el DNU 70/2023 son de forma libre." />

    <form class="stack" @submit.prevent="guardar">
      <section class="card stack">
        <h2>Propiedad y plazo</h2>
        <div class="grid">
          <label class="campo ancho2"><span>Propiedad *</span>
            <select v-model="f.propiedadId" required>
              <option value="" disabled>Elegí una…</option>
              <option v-for="p in propiedades" :key="p.id" :value="p.id">
                {{ p.etiqueta }} — {{ p.direccion }}
              </option>
            </select>
          </label>
          <label class="campo"><span>Inicio *</span><input v-model="f.fechaInicio" type="date" required /></label>
          <label class="campo"><span>Fin *</span><input v-model="f.fechaFin" type="date" required /></label>
          <label class="campo"><span>Inquilino</span>
            <select v-model="f.locatarioId">
              <option value="">—</option>
              <option v-for="p in personas" :key="p.id" :value="p.id">{{ p.nombreCompleto }}</option>
            </select>
          </label>
        </div>
      </section>

      <section class="card stack">
        <h2>Dinero</h2>
        <div class="grid">
          <label class="campo"><span>Moneda</span>
            <select v-model="f.moneda"><option value="ARS">ARS</option><option value="USD">USD</option></select>
          </label>
          <label class="campo"><span>Alquiler inicial *</span><input v-model="f.montoInicial" inputmode="decimal" required /></label>
          <label class="campo"><span>Vence el día</span><input v-model="f.diaVencimiento" inputmode="numeric" /></label>
          <label class="campo"><span>Honorarios %</span><input v-model="f.honorariosPct" inputmode="decimal" /></label>
          <label class="campo"><span>Depósito</span><input v-model="f.deposito" inputmode="decimal" /></label>
        </div>
        <label class="check">
          <input v-model="f.administrado" type="checkbox" />
          <span>
            <strong>Administrado</strong> — la inmobiliaria cobra y liquida al propietario.
            Sin tildar, es sólo intermediación y no genera cuotas.
          </span>
        </label>
      </section>

      <section class="card stack">
        <h2>Actualización</h2>
        <div class="grid">
          <label class="campo"><span>Índice</span>
            <select v-model="f.indice">
              <option value="ipc">IPC — INDEC</option>
              <option value="icl">ICL — BCRA</option>
              <option value="uva">UVA — BCRA</option>
              <option value="icp">Casa Propia</option>
              <option value="porcentaje_fijo">Porcentaje fijo</option>
              <option value="ninguno">Sin actualización</option>
            </select>
          </label>
          <label v-if="f.indice === 'porcentaje_fijo'" class="campo">
            <span>Porcentaje</span><input v-model="f.indicePorcentaje" inputmode="decimal" />
          </label>
          <label v-if="f.indice !== 'ninguno'" class="campo">
            <span>Cada (meses)</span><input v-model="f.periodicidadMeses" inputmode="numeric" />
          </label>
          <label v-if="!['ninguno', 'porcentaje_fijo'].includes(f.indice)" class="campo">
            <span>Mes base</span><input v-model="f.mesBase" type="month" />
          </label>
        </div>
        <p class="nota">
          El mes base es contra el que se mide el primer aumento. Si se deja vacío, se toma
          el mes de inicio del contrato.
        </p>
      </section>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <div class="row">
        <button class="btn" type="submit" :disabled="guardando">{{ guardando ? 'Guardando…' : 'Crear contrato' }}</button>
        <button class="btn secondary" type="button" @click="router.back()">Cancelar</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--s-md); }
.ancho2 { grid-column: span 2; }
.campo input, .campo select { font: inherit; padding: var(--s-sm) var(--s-md); border: 1px solid var(--line-strong); border-radius: var(--r-md); background: var(--surface); color: var(--ink); }
.check { display: flex; gap: var(--s-sm); align-items: flex-start; font-size: 13px; color: var(--muted); }
.check input { margin-top: 3px; }
.check strong { color: var(--ink); }
</style>
