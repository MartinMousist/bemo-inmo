// `defineConfig` de vitest y no de vite: es el mismo, con el bloque `test`
// tipado. Con el de vite, `vue-tsc` marca `test` como propiedad desconocida.
import { defineConfig } from 'vitest/config';
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
  test: {
    // `jsdom` y no `happy-dom`: lo que se prueba acá incluye foco, teclado y
    // `matchMedia`, donde las diferencias entre implementaciones se notan.
    environment: 'jsdom',
    include: ['test/**/*.spec.ts'],
    // Zona fija: los tests de fecha comparan contra dd/mm/aaaa, y en UTC un
    // `2026-01-01` argentino se ve como 31/12. Es el bug de zona horaria que
    // este proyecto ya tuvo una vez, y sin fijar la zona el test lo taparía.
    env: { TZ: 'America/Argentina/Buenos_Aires' },
  },
});
