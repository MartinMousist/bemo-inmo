import type { Directive } from 'vue';

/**
 * `v-revelar` — el elemento aparece cuando entra en pantalla.
 *
 * Con IntersectionObserver y no con listener de scroll: un `scroll` corre en el
 * hilo principal decenas de veces por segundo y hay que medir posiciones a mano,
 * lo que fuerza reflow. El observador lo resuelve el navegador y avisa una vez.
 *
 * Tres decisiones que importan:
 *
 * - **Se desconecta al revelar.** Es de una sola vez: una sección que se
 *   desvanece cuando volvés a subir es un truco, no una mejora.
 * - **`prefers-reduced-motion` sale por la puerta de adelante**: no observa
 *   nada, marca visible y listo. Atenuar la animación no alcanza — hay gente
 *   que se marea, y para ellos el efecto correcto es que no exista.
 * - **Si no hay IntersectionObserver, todo visible.** Degradar a una página en
 *   blanco sería peor que no tener el efecto.
 *
 * Uso: `<section v-revelar>` o `v-revelar="2"` para escalonar (0 a 3).
 */
export const revelar: Directive<HTMLElement, number | undefined> = {
  mounted(el, binding) {
    const paso = binding.value;
    if (typeof paso === 'number' && paso > 0) {
      el.classList.add(`paso-${Math.min(paso, 3)}`);
    }

    const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (sinMovimiento || !('IntersectionObserver' in window)) {
      el.classList.add('revelar', 'visible');
      return;
    }

    el.classList.add('revelar');

    const obs = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          el.classList.add('visible');
          obs.disconnect();
        }
      },
      // Se dispara cuando asoma el 12% del bloque, y con un margen negativo
      // abajo para que no aparezca justo en el borde: tiene que verse entrar.
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );

    obs.observe(el);
    // Guardado para poder cortar si el componente se desmonta antes de entrar.
    (el as HTMLElement & { _obsRevelar?: IntersectionObserver })._obsRevelar = obs;
  },

  unmounted(el) {
    (el as HTMLElement & { _obsRevelar?: IntersectionObserver })._obsRevelar?.disconnect();
  },
};
