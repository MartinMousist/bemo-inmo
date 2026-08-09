import { ref, type Ref } from 'vue';

/**
 * Qué bloques de una ficha quedaron abiertos y cuáles plegados.
 *
 * Hermano de `filtros.ts` y de `sidebar.ts`, y no una llamada a
 * `filtrosRecordados`: la forma del dato es distinta —un mapa id→abierto, no un
 * objeto de campos con valores— y las reglas de validación también.
 *
 * Cuatro reglas que este helper se impone. Las dos primeras son las que
 * decidieron la forma del almacén, así que conviene leerlas antes de
 * "simplificarlo":
 *
 * 1. **Se guarda lo que la persona DECIDIÓ, no el estado completo.** El almacén
 *    lleva sólo los bloques que alguien tocó; los que no están usan su default.
 *    Si se guardara el estado entero, el bloque que se agregue en tres meses
 *    llegaría **cerrado** para todo el que alguna vez tocó la preferencia —o
 *    sea, para todos— y nadie lo encontraría nunca. Es el mismo razonamiento de
 *    la regla 2 de `filtros.ts`, y la versión "simple" es justamente la que hay
 *    que resistir.
 *
 * 2. **Por USUARIO, no por navegador.** En el mostrador de una inmobiliaria la
 *    máquina es una y las personas son tres. Que el titular cierre Cuotas y el
 *    asesor la encuentre cerrada es el bug: se buscaría la cobranza en una
 *    pantalla que no la muestra.
 *
 * 3. **Por ÁREA, no por entidad.** `bloques_contrato`, nunca
 *    `bloques_contrato_<id>`. Es una decisión de espacio de trabajo —el
 *    argumento textual de `sidebar.ts`—: por contrato la preferencia sería
 *    invisible, porque no volvés a esa ficha en meses, y `localStorage`
 *    crecería sin techo. Es el análogo de la regla 1 de `filtros.ts` («la página
 *    no se recuerda»): se recuerda la forma del escritorio, no el contenido.
 *    Corolario: un id guardado que ya no existe —el bloque Cuotas de un contrato
 *    que dejó de ser administrado— se descarta en silencio al leer.
 *
 * 4. **Un `localStorage` que falla no rompe la pantalla.** En modo privado de
 *    Safari escribir tira excepción. Una preferencia que no se recuerda es una
 *    molestia; una ficha en blanco es un bug.
 */

export interface BloquesRecordados {
  /** El estado de cada bloque: el default, pisado por lo que la persona tocó. */
  abiertos: Ref<Record<string, boolean>>;
  alternar: (id: string) => void;
  /** Abre o cierra sin alternar. Lo usa «Abrir todo» y la apertura de cortesía. */
  fijar: (id: string, abierto: boolean) => void;
  abrirTodos: () => void;
  cerrarTodos: () => void;
  /** Borra la preferencia y vuelve a los defaults. La salida de quien se perdió. */
  volverAlDefecto: () => void;
  /** Cuántos hay cerrados ahora. Va en la etiqueta del control, con su número. */
  cerrados: () => number;
  /** `true` si hay algo guardado: sin eso, «Volver a como venía» no hace nada. */
  hayPreferencia: () => boolean;
  /**
   * Abre un bloque **sin escribir la preferencia**.
   *
   * Es la apertura de cortesía de `?nuevo=1`: al aterrizar en un contrato recién
   * creado conviene ver los garantes, la comisión y el pre-contrato, pero eso lo
   * decidió el sistema, no la persona. Guardarlo haría que la próxima ficha que
   * abra —de un contrato de hace dos años— apareciera con tres bloques abiertos
   * que nadie pidió.
   */
  abrirDeCortesia: (ids: string[]) => void;
}

export function bloquesRecordados(
  area: string,
  porDefecto: Record<string, boolean>,
  usuarioId: string | null | undefined,
): BloquesRecordados {
  // Regla 2. Sin usuario —la sesión todavía no restauró— se usa una clave
  // aparte en vez de escribir bajo la de nadie: si guardáramos en
  // `…_undefined`, esa preferencia no la volvería a leer ninguna sesión con
  // usuario y parecería que «no se acuerda». Hoy el guard del router espera
  // `auth.listo` antes de montar la ficha, así que el caso no debería pasar;
  // esto es para que el día que deje de esperarlo, falle visible y no en
  // silencio.
  const almacen = `bemo_inmo_bloques_${area}_${usuarioId ?? 'anonimo'}`;

  /** SÓLO lo que la persona tocó. Regla 1. */
  const tocados: Record<string, boolean> = {};

  try {
    const crudo = localStorage.getItem(almacen);
    if (crudo) {
      const guardado = JSON.parse(crudo) as Record<string, unknown>;
      for (const [id, v] of Object.entries(guardado)) {
        // Regla 3: un id que ya no existe en esta ficha se descarta.
        if (!(id in porDefecto)) continue;
        if (typeof v !== 'boolean') continue;
        tocados[id] = v;
      }
    }
  } catch {
    // Regla 4.
  }

  const abiertos = ref<Record<string, boolean>>({ ...porDefecto, ...tocados });

  function persistir() {
    try {
      // Se escribe `tocados`, no `abiertos.value`. Ver regla 1: guardar el
      // estado completo es lo que deja invisible al bloque que se agregue
      // después.
      if (Object.keys(tocados).length === 0) localStorage.removeItem(almacen);
      else localStorage.setItem(almacen, JSON.stringify(tocados));
    } catch {
      // Regla 4.
    }
  }

  function fijar(id: string, abierto: boolean) {
    if (!(id in porDefecto)) return;
    tocados[id] = abierto;
    abiertos.value = { ...abiertos.value, [id]: abierto };
    persistir();
  }

  function alternar(id: string) {
    fijar(id, !abiertos.value[id]);
  }

  function todos(abierto: boolean) {
    for (const id of Object.keys(porDefecto)) tocados[id] = abierto;
    abiertos.value = Object.fromEntries(
      Object.keys(porDefecto).map((id) => [id, abierto]),
    );
    persistir();
  }

  function volverAlDefecto() {
    for (const id of Object.keys(tocados)) delete tocados[id];
    abiertos.value = { ...porDefecto };
    persistir();
  }

  function abrirDeCortesia(ids: string[]) {
    const siguiente = { ...abiertos.value };
    for (const id of ids) {
      if (!(id in porDefecto)) continue;
      // Si la persona ya decidió sobre este bloque, su decisión manda: abrirle
      // de prepo el que cerró a propósito es peor que no abrir nada.
      if (id in tocados) continue;
      siguiente[id] = true;
    }
    abiertos.value = siguiente;
    // A propósito NO se llama a `persistir()`: es cortesía, no una decisión.
  }

  return {
    abiertos,
    alternar,
    fijar,
    abrirTodos: () => todos(true),
    cerrarTodos: () => todos(false),
    volverAlDefecto,
    cerrados: () => Object.values(abiertos.value).filter((v) => !v).length,
    hayPreferencia: () => Object.keys(tocados).length > 0,
    abrirDeCortesia,
  };
}
