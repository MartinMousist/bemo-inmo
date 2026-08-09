<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';
import { ETIQUETA_ORIGEN } from '../dominio/formato';

const router = useRouter();
const form = reactive({
  nombre: '', telefono: '', email: '',
  origen: 'whatsapp', interes: 'alquiler',
  presupuestoMax: '', moneda: 'ARS', notas: '',
});
const guardando = ref(false);
const error = ref('');

async function guardar() {
  error.value = ''; guardando.value = true;
  try {
    const max = Number(form.presupuestoMax);
    await api('/oportunidades', {
      method: 'POST',
      body: JSON.stringify({
        persona: {
          nombre: form.nombre,
          telefono: form.telefono || undefined,
          email: form.email || undefined,
        },
        origen: form.origen,
        interes: form.interes,
        presupuestoMax: form.presupuestoMax.trim() && !Number.isNaN(max) ? max : undefined,
        moneda: form.moneda,
        notas: form.notas || undefined,
      }),
    });
    router.replace('/leads');
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo guardar.';
  } finally { guardando.value = false; }
}
</script>

<template>
  <div class="stack">
    <PageHeader
      titulo="Nuevo lead"
      bajada="Si la persona no existe, se crea junto con el lead. No hace falta ir a otra pantalla."
    />
    <form class="card stack" @submit.prevent="guardar">
      <div class="grid">
        <label class="campo"><span>Nombre *</span><input v-model="form.nombre" required autofocus maxlength="120" /></label>
        <label class="campo"><span>Teléfono</span><input v-model="form.telefono" inputmode="tel" maxlength="40" /></label>
        <label class="campo"><span>Correo</span><input v-model="form.email" type="email" maxlength="120" /></label>
        <label class="campo">
          <span>Origen</span>
          <select v-model="form.origen">
            <option v-for="(t, k) in ETIQUETA_ORIGEN" :key="k" :value="k">{{ t }}</option>
          </select>
        </label>
        <label class="campo">
          <span>Busca</span>
          <select v-model="form.interes"><option value="alquiler">Alquiler</option><option value="venta">Venta</option></select>
        </label>
        <label class="campo">
          <span>Moneda</span>
          <select v-model="form.moneda"><option value="ARS">ARS</option><option value="USD">USD</option></select>
        </label>
        <label class="campo"><span>Presupuesto hasta</span><input v-model="form.presupuestoMax" inputmode="decimal" /></label>
      </div>
      <label class="campo"><span>Notas</span><textarea v-model="form.notas" rows="3" maxlength="4000" /></label>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <div class="row">
        <button class="btn" type="submit" :disabled="guardando">{{ guardando ? 'Guardando…' : 'Registrar' }}</button>
        <button class="btn secondary" type="button" @click="router.back()">Cancelar</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--s-md); }
.campo input, .campo select, .campo textarea {
  font: inherit; padding: var(--s-sm) var(--s-md); border: 1px solid var(--line-strong);
  border-radius: var(--r-md); background: var(--surface); color: var(--ink);
}
.campo textarea { resize: vertical; }
</style>
