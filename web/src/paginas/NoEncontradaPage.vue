<script setup lang="ts">
import { useRouter } from 'vue-router';
const router = useRouter();
</script>

<template>
  <div class="nf">
    <h1>Esa página no existe</h1>
    <p>Puede que el enlace esté mal o que la ficha se haya borrado.</p>
    <div class="row">
      <button class="btn" type="button" @click="router.push('/propiedades')">Ir a propiedades</button>
      <button class="btn secondary" type="button" @click="router.back()">Volver</button>
    </div>
  </div>
</template>

<style scoped>
.nf { padding: var(--s-3xl) 0; text-align: center; }
h1 { font-size: 22px; }
p { color: var(--muted); margin: var(--s-sm) 0 var(--s-xl); }
.row { justify-content: center; }
</style>
