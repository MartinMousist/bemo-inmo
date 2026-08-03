<script setup lang="ts">
defineProps<{ texto: string; tono?: 'neutro' | 'ok' | 'warn' | 'err' | 'acento' }>();
</script>

<template>
  <span class="chip" :class="tono ?? 'neutro'">{{ texto }}</span>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--s-sm);
  font-size: 12px;
  font-weight: 500;
  border-radius: var(--r-sm);
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--muted);
  white-space: nowrap;
}
.ok     { background: var(--success-tint); border-color: var(--success-line); color: var(--success); }
.warn   { background: var(--warning-tint); border-color: var(--warning-line); color: var(--warning); }
.err    { background: var(--danger-tint);  border-color: var(--danger-line);  color: var(--danger); }
.acento { background: var(--accent-tint);  border-color: var(--accent-line);  color: var(--accent); }
</style>
