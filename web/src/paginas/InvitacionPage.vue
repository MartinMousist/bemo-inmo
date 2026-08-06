<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthLayout from '../layouts/AuthLayout.vue';
import CampoPassword from '../componentes/CampoPassword.vue';
import { api, ApiError, fijarToken } from '../api/cliente';
import { useAuth } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuth();

const token = route.params.token as string;
const nombre = ref('');
const password = ref('');
const error = ref('');
const enviando = ref(false);

async function aceptar() {
  error.value = '';
  enviando.value = true;
  try {
    const s = await api<{
      accessToken: string;
      usuario: { id: string; nombre: string };
      tenant: { id: string; nombre: string };
      rol: 'owner' | 'admin' | 'agente' | 'contable';
    }>('/auth/invitacion/aceptar', {
      method: 'POST',
      body: JSON.stringify({ token, password: password.value, nombre: nombre.value }),
    });

    fijarToken(s.accessToken);
    auth.usuario = s.usuario;
    auth.tenant = s.tenant;
    auth.rol = s.rol;
    await router.replace('/inicio');
  } catch (e) {
    // El back distingue invitación inexistente, ya aceptada, cancelada y
    // vencida, y cada una tiene su texto. Mostramos el que vino.
    error.value =
      e instanceof ApiError ? e.paraMostrar : 'No se pudo conectar con el servidor.';
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <AuthLayout>
    <form class="card stack" @submit.prevent="aceptar">
      <div>
        <h2 class="text-lg">Sumarte al equipo</h2>
        <p class="sub">Elegí tu contraseña para activar la cuenta.</p>
      </div>

      <label class="campo">
        <span>Tu nombre</span>
        <input v-model="nombre" autofocus required maxlength="120" autocomplete="name" />
      </label>

      <CampoPassword
        v-model="password"
        etiqueta="Contraseña"
        autocomplete="new-password"
        ayuda="Al menos 10 caracteres."
      />

      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <button class="btn block" type="submit" :disabled="enviando">
        {{ enviando ? 'Activando…' : 'Activar cuenta' }}
      </button>
    </form>
  </AuthLayout>
</template>

<style scoped>
.sub {
  margin: var(--s-xs) 0 0;
  color: var(--muted);
}
.campo input {
  font: inherit;
  padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
}
</style>
