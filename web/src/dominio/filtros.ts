import { ref, watch, type Ref } from 'vue';
import type { Router } from 'vue-router';

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
  /**
   * La regla 2, aplicada a una lista que **todavía no existía** cuando se leyó
   * el `localStorage`.
   *
   * El constructor valida contra listas estáticas —los estados de cobranza, los
   * índices— porque están en el bundle. El filtro por agente no: el equipo llega
   * por `GET /v1/equipo`, después del primer render. Sin esto, un uuid guardado
   * de alguien que ya no está en la inmobiliaria deja la pantalla mostrando cero
   * filas para siempre, y el usuario no eligió nada — es exactamente el caso que
   * la regla 2 existe para evitar.
   *
   * La pantalla la llama cuando llegó el equipo, y sólo entonces.
   */
  revalidar: (clave: keyof T, permitidos: readonly string[]) => void;
}

export function filtrosRecordados<T extends Record<string, string | boolean>>(
  clave: string,
  porDefecto: T,
  validos: Partial<{ [K in keyof T]: readonly string[] }> = {},
  /**
   * Qué se guarda, cuando no es todo. Lo usa `filtrosEnUrl` para su regla 4:
   * hay filtros que tienen que viajar en un enlace y NO sobrevivir a mañana.
   * Por defecto se guarda el objeto entero, como venía.
   */
  paraGuardar: (v: T) => T = (v) => v,
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
        localStorage.setItem(almacen, JSON.stringify(paraGuardar(v)));
      } catch {
        // Regla 3.
      }
    },
    { deep: true },
  );

  function limpiar() {
    valores.value = { ...porDefecto };
  }

  function revalidar(clave: keyof T, permitidos: readonly string[]) {
    const v = valores.value[clave];
    if (typeof v !== 'string' || v === '') return;
    if (permitidos.includes(v)) return;
    valores.value = { ...valores.value, [clave]: porDefecto[clave] };
  }

  return { valores, limpiar, revalidar };
}

/**
 * Un filtro que además VIAJA EN LA URL, para poder pasarlo por WhatsApp.
 *
 * Hasta acá ninguna pantalla del repo sincronizaba filtros con la URL: los
 * filtros se recordaban en `localStorage` y `useRoute` sólo se usaba para leer
 * el path. Eso alcanza mientras el filtro sea una preferencia personal —«los
 * que están en mora»—, y deja de alcanzar cuando el filtro es *de qué se está
 * hablando*: «mirá los propietarios» no se puede mandar.
 *
 * Cuatro reglas, cada una con su motivo:
 *
 * 1. **La URL GANA sobre lo recordado.** Si alguien te pasó el enlace de los
 *    propietarios y vos habías dejado puesto «garantes», el enlace tiene que
 *    aterrizar en propietarios. Una preferencia guardada que pisa un enlace
 *    compartido rompe la única razón de que el filtro esté en la URL.
 *
 * 2. **Un valor inválido en la URL cae al DEFECTO, en silencio.** Mandarlo al
 *    backend sería comerse un 400 y quedarse con la pantalla en blanco por una
 *    letra de más en un enlace.
 *
 *    Y cae al defecto, no a lo recordado, que es la diferencia sutil: si la
 *    clave VIENE en la URL, quien mandó el enlace estaba eligiendo el filtro.
 *    Con un valor que no existe, respetar la preferencia guardada mostraría una
 *    lista filtrada que no eligió NINGUNO de los dos —ni el que mandó el
 *    enlace, ni el que lo abre—, y encima sin nada en pantalla que lo explique.
 *    Se probó en el navegador con `?rol=locador`: caía en la pestaña recordada.
 *
 * 3. **`push` para lo que es navegación, `replace` para lo que es tipear.** El
 *    cambio de pestaña va con `push`: el usuario espera que «atrás» lo devuelva
 *    a la pestaña anterior. El buscador y la página van con `replace`, porque
 *    con debounce un `push` por tecla llena el historial y «atrás» deja de
 *    funcionar como salida de la pantalla.
 *
 * 4. **Lo que viaja no siempre se guarda.** El texto del buscador va a la URL
 *    —compartir «los propietarios que dicen Gómez» es legítimo— pero NO a
 *    `localStorage`: arrancar mañana con un texto que no escribiste, y una
 *    lista de tres filas, es el bug que ContratosPage ya tiene documentado.
 */
export interface OpcionesUrl<T> {
  router: Router;
  /** Query actual al montar. Se lee una vez: después manda `valores`. */
  queryInicial: Record<string, string | string[] | null | undefined>;
  /** Claves que van a la URL. Las que no están, no viajan. */
  enUrl: Array<keyof T & string>;
  /** De esas, cuáles NO se guardan en localStorage. Regla 4. */
  noRecordar?: Array<keyof T & string>;
  /** De esas, cuáles navegan con `push` en vez de `replace`. Regla 3. */
  conHistorial?: Array<keyof T & string>;
}

export function filtrosEnUrl<T extends Record<string, string | boolean>>(
  clave: string,
  porDefecto: T,
  opciones: OpcionesUrl<T>,
  validos: Partial<{ [K in keyof T]: readonly string[] }> = {},
): FiltroRecordado<T> {
  const noRecordar = new Set(opciones.noRecordar ?? []);

  // Lo recordado es la base…
  const base = filtrosRecordados(
    clave,
    porDefecto,
    validos,
    (v) => {
      // Regla 4: se guarda todo menos lo explícitamente excluido.
      const guardable = { ...v };
      for (const k of noRecordar) guardable[k] = porDefecto[k];
      return guardable;
    },
  );

  // …y la URL la pisa. Regla 1.
  const desdeUrl: Partial<T> = {};
  for (const k of opciones.enUrl) {
    const crudo = opciones.queryInicial[k];
    const v = Array.isArray(crudo) ? crudo[0] : crudo;
    if (typeof v !== 'string') continue;

    if (typeof porDefecto[k] === 'boolean') {
      desdeUrl[k] = (v === 'true') as T[typeof k];
      continue;
    }
    // Regla 2: la clave VINO en la URL, así que manda la URL. Si el valor no
    // está en la lista blanca, se cae al defecto —y no a lo recordado, ni al
    // valor inválido—, en silencio.
    const permitidos = validos[k];
    desdeUrl[k] =
      permitidos && v !== '' && !permitidos.includes(v) ? porDefecto[k] : (v as T[typeof k]);
  }
  if (Object.keys(desdeUrl).length) {
    base.valores.value = { ...base.valores.value, ...desdeUrl };
  }

  // De acá en adelante, la URL sigue a los valores.
  let anterior = { ...base.valores.value };
  watch(
    base.valores,
    (v) => {
      const query: Record<string, string> = {};
      for (const k of opciones.enUrl) {
        // Lo que está en su valor por defecto NO se escribe: una URL con
        // `?rol=&q=&pagina=1` no dice nada más que `/personas` y se copia peor.
        if (v[k] === porDefecto[k] || v[k] === '' || v[k] === false) continue;
        query[k] = String(v[k]);
      }

      // Regla 3: si lo que cambió incluye una clave «de navegación», es un
      // push; si sólo cambió el buscador o la página, es un replace.
      const navegacion = (opciones.conHistorial ?? []).some((k) => v[k] !== anterior[k]);
      anterior = { ...v };

      const destino = { query };
      void (navegacion
        ? opciones.router.push(destino)
        : opciones.router.replace(destino));
    },
    { deep: true },
  );

  return base;
}
