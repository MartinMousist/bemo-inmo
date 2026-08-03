<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthLayout from '../layouts/AuthLayout.vue';
import CampoPassword from '../componentes/CampoPassword.vue';
import { useAuth } from '../stores/auth';
import { ApiError } from '../api/cliente';

const auth = useAuth();
const router = useRouter();
const route = useRoute();

const email = ref('');
const password = ref('');
const error = ref('');
const enviando = ref(false);

async function enviar() {
  error.value = '';
  enviando.value = true;
  try {
    await auth.login(email.value, password.value);
    // Vuelve adonde estaba antes de que lo rebotara el guard.
    const destino = (route.query.next as string) || '/';
    await router.replace(destino);
  } catch (e) {
    // El mensaje real de la API, no un genérico: el back ya se ocupa de no
    // revelar si el correo existe.
    error.value =
      e instanceof ApiError ? e.detail : 'No se pudo conectar con el servidor.';
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <AuthLayout>
    <form class="card stack" @submit.prevent="enviar">
      <div>
        <h2>Entrar</h2>
        <p class="sub">Ingresá con tu cuenta de la inmobiliaria.</p>
      </div>

      <label class="campo">
        <span>Correo</span>
        <input
          v-model="email"
          type="email"
          autocomplete="username"
          autofocus
          required
          placeholder="vos@inmobiliaria.com"
        />
      </label>

      <CampoPassword v-model="password" etiqueta="Contraseña" autocomplete="current-password" />

      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <button class="btn block" type="submit" :disabled="enviando">
        {{ enviando ? 'Entrando…' : 'Entrar' }}
      </button>

      <p class="pie">
        ¿No tenés cuenta?
        <RouterLink to="/registrar">Registrá tu inmobiliaria</RouterLink>
      </p>
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
