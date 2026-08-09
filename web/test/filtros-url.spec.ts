import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { filtrosEnUrl } from '../src/dominio/filtros';
import type { Router } from 'vue-router';

/**
 * Las cuatro reglas de `filtrosEnUrl`, cada una con el bug que evita.
 *
 * No se prueba «guarda y lee»: eso lo cumpliría cualquier implementación,
 * incluida la que deja que la preferencia guardada pise un enlace compartido —
 * que es exactamente la que rompe la única razón de que el filtro esté en la
 * URL—. Lo que se prueba es QUIÉN GANA en cada caso.
 */

const ROLES = ['propietario', 'inquilino', 'garante'] as const;
const DEFECTO = { rol: '', q: '', pagina: '1' };
const CLAVE = 'bemo_inmo_filtros_personas';

/** Un router de mentira que sólo anota adónde lo mandaron y con qué método. */
function routerFalso() {
  const llamadas: Array<{ metodo: 'push' | 'replace'; query: Record<string, string> }> = [];
  const router = {
    push: (d: { query: Record<string, string> }) => {
      llamadas.push({ metodo: 'push', query: d.query });
      return Promise.resolve();
    },
    replace: (d: { query: Record<string, string> }) => {
      llamadas.push({ metodo: 'replace', query: d.query });
      return Promise.resolve();
    },
  } as unknown as Router;
  return { router, llamadas };
}

function armar(queryInicial: Record<string, string> = {}) {
  const { router, llamadas } = routerFalso();
  const f = filtrosEnUrl(
    'personas',
    DEFECTO,
    {
      router,
      queryInicial,
      enUrl: ['rol', 'q', 'pagina'],
      noRecordar: ['q', 'pagina'],
      conHistorial: ['rol'],
    },
    { rol: ROLES },
  );
  return { ...f, llamadas };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('regla 1 — la URL gana sobre lo recordado', () => {
  it('un enlace compartido pisa la preferencia guardada', () => {
    // Alguien había dejado puesto «garante» y le mandan el de propietarios.
    localStorage.setItem(CLAVE, JSON.stringify({ rol: 'garante', q: '', pagina: '1' }));

    const { valores } = armar({ rol: 'propietario' });

    // Si acá saliera 'garante', el enlace no serviría para nada: te mandan
    // «mirá los propietarios» y ves los garantes.
    expect(valores.value.rol).toBe('propietario');
  });

  it('sin nada en la URL, manda lo recordado', () => {
    localStorage.setItem(CLAVE, JSON.stringify({ rol: 'garante', q: '', pagina: '1' }));
    const { valores } = armar({});
    expect(valores.value.rol).toBe('garante');
  });
});

describe('regla 2 — un valor inválido en la URL cae al DEFECTO, en silencio', () => {
  it('`rol=locador` no rompe la pantalla ni viaja al backend', () => {
    // `locador` es una parte real de un contrato y NO es un rol derivado: es
    // justo el valor que alguien va a tipear. Mandárselo al backend sería un
    // 400 y la pantalla en blanco.
    const { valores } = armar({ rol: 'locador' });
    expect(valores.value.rol).toBe('');
  });

  it('cae al defecto y NO a lo recordado', () => {
    // La diferencia sutil: la clave VINO en la URL, así que quien mandó el
    // enlace estaba eligiendo el filtro. Respetar la preferencia guardada
    // mostraría una lista que no eligió ninguno de los dos. Se encontró
    // probándolo en el navegador, no leyendo el código.
    localStorage.setItem(CLAVE, JSON.stringify({ rol: 'garante', q: '', pagina: '1' }));
    const { valores } = armar({ rol: 'locador' });
    expect(valores.value.rol).toBe('');
  });

  it('un valor válido sí entra', () => {
    const { valores } = armar({ rol: 'inquilino' });
    expect(valores.value.rol).toBe('inquilino');
  });
});

describe('regla 3 — push para navegar, replace para tipear', () => {
  it('cambiar de pestaña va con push: «atrás» tiene que volver', async () => {
    const { valores, llamadas } = armar({});
    valores.value = { ...valores.value, rol: 'garante' };
    await nextTick();

    expect(llamadas.at(-1)).toEqual({ metodo: 'push', query: { rol: 'garante' } });
  });

  it('tipear en el buscador va con replace: un push por tecla mata el historial', async () => {
    const { valores, llamadas } = armar({});
    valores.value = { ...valores.value, q: 'gomez' };
    await nextTick();

    expect(llamadas.at(-1)).toEqual({ metodo: 'replace', query: { q: 'gomez' } });
  });

  it('lo que está en su valor por defecto no se escribe en la URL', async () => {
    // `?rol=&q=&pagina=1` no dice nada más que `/personas` y se copia peor.
    const { valores, llamadas } = armar({});
    valores.value = { ...valores.value, rol: 'garante', q: '', pagina: '1' };
    await nextTick();

    expect(llamadas.at(-1)!.query).toEqual({ rol: 'garante' });
  });
});

describe('regla 4 — lo que viaja no siempre se guarda', () => {
  it('el rol se recuerda', async () => {
    const { valores } = armar({});
    valores.value = { ...valores.value, rol: 'garante' };
    await nextTick();

    expect(JSON.parse(localStorage.getItem(CLAVE)!).rol).toBe('garante');
  });

  it('el texto del buscador NO se guarda, aunque sí viaje en la URL', async () => {
    // Compartir «los propietarios que dicen Gómez» es legítimo; arrancar mañana
    // con un texto que no escribiste, y tres filas, es el bug que ContratosPage
    // ya tiene documentado.
    const { valores } = armar({});
    valores.value = { ...valores.value, q: 'gomez', rol: 'garante' };
    await nextTick();

    const guardado = JSON.parse(localStorage.getItem(CLAVE)!);
    expect(guardado.q).toBe('');
    expect(guardado.rol).toBe('garante');
  });

  it('la página tampoco se guarda', async () => {
    const { valores } = armar({});
    valores.value = { ...valores.value, pagina: '7' };
    await nextTick();

    expect(JSON.parse(localStorage.getItem(CLAVE)!).pagina).toBe('1');
  });
});

describe('un localStorage que falla no rompe la pantalla', () => {
  it('el filtro sigue funcionando si escribir tira excepción', async () => {
    // Modo privado de Safari. Un filtro que no se recuerda es una molestia;
    // una pantalla en blanco es un bug.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const { valores, llamadas } = armar({});
    valores.value = { ...valores.value, rol: 'garante' };
    await nextTick();

    expect(valores.value.rol).toBe('garante');
    expect(llamadas.at(-1)!.query).toEqual({ rol: 'garante' });
  });
});
