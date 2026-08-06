import { ref, watch, type Ref } from 'vue';

/**
 * Filtros que se recuerdan entre visitas.
 *
 * Cada usuario mira dos o tres cosas —«los que están en mora», «los que vencen
 * este trimestre»— y hasta acá las volvía a tipear en cada carga. Es la misma
 * lógica por la que la barra lateral plegada se guarda: es una decisión de
 * espacio de trabajo, no un estado de sesión.
 *
 * Tres reglas que este helper se impone:
 *
 * 1. **La página NO se recuerda.** Volver a una pantalla y aterrizar en la
 *    página 7 de algo es desorientador; el filtro es una preferencia, la página
 *    es dónde quedaste hace tres días.
 *
 * 2. **Un valor guardado que ya no es válido se descarta.** Si mañana
 *    desaparece el estado `parcial`, el filtro guardado mandaría un valor que el
 *    backend rechaza con 400 y la pantalla no cargaría nunca — sin que el
 *    usuario entienda por qué, porque él no eligió nada.
 *
 * 3. **Un `localStorage` que falla no rompe la pantalla.** En modo privado de
 *    Safari escribir tira excepción. Un filtro que no se recuerda es una
 *    molestia; una pantalla en blanco es un bug.
 */
export interface FiltroRecordado<T> {
  valores: Ref<T>;
  limpiar: () => void;
}

export function filtrosRecordados<T extends Record<string, string | boolean>>(
  clave: string,
  porDefecto: T,
  validos: Partial<{ [K in keyof T]: readonly string[] }> = {},
): FiltroRecordado<T> {
  const almacen = `bemo_inmo_filtros_${clave}`;

  const valores = ref<T>({ ...porDefecto }) as Ref<T>;

  try {
    const crudo = localStorage.getItem(almacen);
    if (crudo) {
      const guardado = JSON.parse(crudo) as Partial<T>;
      const limpio = { ...porDefecto };
      for (const k of Object.keys(porDefecto) as Array<keyof T>) {
        const v = guardado[k];
        if (v === undefined || typeof v !== typeof porDefecto[k]) continue;
        // Regla 2: un valor que ya no está en la lista se descarta en silencio.
        const permitidos = validos[k];
        if (permitidos && typeof v === 'string' && v !== '' && !permitidos.includes(v)) continue;
        limpio[k] = v as T[keyof T];
      }
      valores.value = limpio;
    }
  } catch {
    // Regla 3.
  }

  watch(
    valores,
    (v) => {
      try {
        localStorage.setItem(almacen, JSON.stringify(v));
      } catch {
        // Regla 3.
      }
    },
    { deep: true },
  );

  function limpiar() {
    valores.value = { ...porDefecto };
  }

  return { valores, limpiar };
}
