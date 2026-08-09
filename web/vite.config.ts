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
    /**
     * La misma CSP que el `Caddyfile` de producción, para que se rompa ACÁ.
     *
     * Una CSP que sólo existe en producción se descubre el día del deploy, con
     * la tipografía caída y el mapa en blanco, y lo primero que se hace es
     * borrarla. Puesta también en dev, cualquier cosa que la viole aparece en
     * la consola mientras se programa.
     *
     * Tres diferencias necesarias con producción, y sólo tres:
     * · `script-src` lleva `'unsafe-inline'` y `'unsafe-eval'`: el cliente de
     *   hot reload de Vite inyecta scripts en línea y evalúa los módulos. En el
     *   build eso no existe.
     * · `connect-src` lleva `ws:` (el websocket del hot reload) y el `:3000` de
     *   la API, que en dev vive en otro puerto. En producción la API va por el
     *   mismo origen a través de Caddy y alcanza `'self'`.
     * · `img-src` lleva `http://localhost:9000`, que es MinIO. En producción el
     *   bucket es https y lo cubre el `https:` que ya está; en dev habla http, y
     *   sin esta línea **el navegador bloquea todas las fotos**: la ficha
     *   mostraba imágenes rotas y la cartera en tarjetas, treinta. Se encontró
     *   mirando la consola con las fotos ya sembradas — de la API salía un 200
     *   y el `<img>` no cargaba, que es el síntoma exacto de una CSP.
     */
    headers: {
      'Content-Security-Policy':
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; " +
        'font-src \'self\' https://fonts.gstatic.com https://cdn.fontshare.com; ' +
        "img-src 'self' data: blob: https: http://localhost:9000; " +
        "connect-src 'self' ws: wss: http://localhost:3000; " +
        'frame-src https://www.google.com; ' +
        "object-src 'none'; base-uri 'none'; form-action 'self'",
    },
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
