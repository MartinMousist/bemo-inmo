<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../api/cliente';
import PageHeader from '../componentes/PageHeader.vue';

const router = useRouter();
const form = reactive({
  tipo: 'fisica', nombre: '', apellido: '', docTipo: 'dni', docNumero: '',
  email: '', telefono: '', domicilio: '', notas: '',
});
const guardando = ref(false);
const error = ref('');

async function guardar() {
  error.value = ''; guardando.value = true;
  try {
    await api('/personas', {
      method: 'POST',
      body: JSON.stringify({
        tipo: form.tipo,
        nombre: form.nombre,
        apellido: form.apellido || undefined,
        docTipo: form.docNumero ? form.docTipo : undefined,
        docNumero: form.docNumero || undefined,
        email: form.email || undefined,
        telefono: form.telefono || undefined,
        domicilio: form.domicilio || undefined,
        notas: form.notas || undefined,
      }),
    });
    router.replace('/personas');
  } catch (e) {
    error.value = e instanceof ApiError ? e.paraMostrar : 'No se pudo guardar.';
  } finally { guardando.value = false; }
}
</script>

<template>
  <div class="stack">
    <PageHeader titulo="Nueva persona" bajada="Una sola ficha por persona: los roles salen de sus operaciones." />
    <form class="card stack" @submit.prevent="guardar">
      <div class="grid">
        <label class="campo">
          <span>Tipo</span>
          <select v-model="form.tipo">
            <option value="fisica">Persona física</option>
            <option value="juridica">Persona jurídica</option>
          </select>
        </label>
        <label class="campo"><span>{{ form.tipo === 'juridica' ? 'Razón social *' : 'Nombre *' }}</span>
          <input v-model="form.nombre" required maxlength="120" autofocus /></label>
        <label v-if="form.tipo === 'fisica'" class="campo"><span>Apellido</span>
          <input v-model="form.apellido" maxlength="120" /></label>
        <label class="campo">
          <span>Tipo de documento</span>
          <select v-model="form.docTipo">
            <option value="dni">DNI</option><option value="cuit">CUIT</option>
            <option value="cuil">CUIL</option><option value="pasaporte">Pasaporte</option>
          </select>
        </label>
        <label class="campo"><span>Número</span><input v-model="form.docNumero" maxlength="20" inputmode="numeric" /></label>
        <label class="campo"><span>Teléfono</span><input v-model="form.telefono" maxlength="40" inputmode="tel" /></label>
        <label class="campo"><span>Correo</span><input v-model="form.email" type="email" maxlength="120" /></label>
        <label class="campo"><span>Domicilio</span><input v-model="form.domicilio" maxlength="200" /></label>
      </div>
      <label class="campo"><span>Notas</span><textarea v-model="form.notas" rows="3" maxlength="2000" /></label>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <div class="row">
        <button class="btn" type="submit" :disabled="guardando">{{ guardando ? 'Guardando…' : 'Crear persona' }}</button>
        <button class="btn secondary" type="button" @click="router.back()">Cancelar</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--s-md); }
.campo input, .campo select, .campo textarea {
  font: inherit; padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink);
}
.campo textarea { resize: vertical; }
</style>
