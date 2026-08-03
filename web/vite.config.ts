import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // El contenedor no recibe eventos de filesystem del host: sin polling el
    // hot reload no se entera de nada y parece que Vite se colgó.
    watch: { usePolling: true },
  },
});
