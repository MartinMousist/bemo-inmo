<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import AuthLayout from '../layouts/AuthLayout.vue';
import CampoPassword from '../componentes/CampoPassword.vue';
import { useAuth } from '../stores/auth';
import { ApiError } from '../api/cliente';

const auth = useAuth();
const router = useRouter();

const inmobiliaria = ref('');
const provincia = ref('');
const nombre = ref('');
const email = ref('');
const password = ref('');
const error = ref('');
const enviando = ref(false);

async function enviar() {
  error.value = '';
  enviando.value = true;
  try {
    await auth.registrar({
      inmobiliaria: inmobiliaria.value,
      provincia: provincia.value || undefined,
      email: email.value,
      password: password.value,
      nombre: nombre.value,
    });
    await router.replace('/inicio');
  } catch (e) {
    error.value =
      e instanceof ApiError ? e.paraMostrar : 'No se pudo conectar con el servidor.';
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <AuthLayout>
    <form class="card stack" @submit.prevent="enviar">
      <div>
        <h2>Crear cuenta</h2>
        <p class="sub">Quedás como titular de la inmobiliaria.</p>
      </div>

      <label class="campo">
        <span>Inmobiliaria</span>
        <input v-model="inmobiliaria" autofocus required maxlength="120" />
      </label>

      <label class="campo">
        <span>Provincia</span>
        <input v-model="provincia" maxlength="60" placeholder="Opcional" />
      </label>

      <label class="campo">
        <span>Tu nombre</span>
        <input v-model="nombre" required maxlength="120" autocomplete="name" />
      </label>

      <label class="campo">
        <span>Correo</span>
        <input v-model="email" type="email" required autocomplete="username" />
      </label>

      <CampoPassword
        v-model="password"
        etiqueta="Contraseña"
        autocomplete="new-password"
        ayuda="Al menos 10 caracteres."
      />

      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <button class="btn block" type="submit" :disabled="enviando">
        {{ enviando ? 'Creando…' : 'Crear cuenta' }}
      </button>

      <p class="pie">¿Ya tenés cuenta? <RouterLink to="/login">Entrar</RouterLink></p>
    </form>
  </AuthLayout>
</template>

<style scoped>
.sub {
  margin: var(--s-xs) 0 0;
  color: var(--muted);
}
.campo {
  display: flex;
  flex-direction: column;
  gap: var(--s-xs);
}
.campo > span {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.campo input {
  font: inherit;
  padding: var(--s-sm) var(--s-md);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
}
.alert {
  margin: 0;
  padding: var(--s-sm) var(--s-md);
  background: var(--danger-tint);
  border: 1px solid var(--danger-line);
  border-radius: var(--r-md);
  color: var(--danger);
  font-size: 13px;
}
.btn.block {
  width: 100%;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.pie {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  text-align: center;
}
.pie a {
  color: var(--accent);
}
</style>
