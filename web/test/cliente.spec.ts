import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El cliente de API: renovación single-flight y manejo de errores.
 *
 * Es la pieza más delicada del front y la única cuyo bug tiene consecuencia
 * inmediata para el usuario: si cinco requests fallan a la vez con 401 y cada
 * uno renueva por su cuenta, el refresh token rota cinco veces. Cuatro quedan
 * con un token ya consumido, y el backend lo interpreta —correctamente— como
 * reuso y **cierra todas las sesiones del usuario**.
 *
 * Se importa en cada test con `resetModules` porque el módulo guarda estado
 * arriba (el access token y la renovación en curso).
 */

function respuesta(status: number, cuerpo: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
    json: async () => cuerpo,
  } as unknown as Response;
}

describe('cliente de API', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('manda el token en Authorization', async () => {
    const { api, fijarToken } = await import('../src/api/cliente');
    fijarToken('token-abc');
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      respuesta(200, { ok: true }),
    );

    await api('/propiedades');

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer token-abc');
    // `credentials: include` es lo que hace viajar la cookie httpOnly del refresh.
    expect(init.credentials).toBe('include');
  });

  it('renueva UNA sola vez aunque fallen cinco requests a la vez', async () => {
    // Es el bug que cierra todas las sesiones del usuario.
    const { api, fijarToken } = await import('../src/api/cliente');
    fijarToken('viejo');

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    let renovaciones = 0;
    const yaFallo = new Set<string>();

    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);

      if (u.endsWith('/auth/refresh')) {
        renovaciones++;
        // Se demora a propósito: es lo que hace que las cinco coincidan en el
        // tiempo. Sin la demora, la primera termina antes de que arranque la
        // segunda y el test pasaría aunque no hubiera single-flight.
        await new Promise((r) => setTimeout(r, 10));
        return respuesta(200, { accessToken: 'nuevo' });
      }

      // Cada request falla una vez con 401 y anda en el reintento.
      if (!yaFallo.has(u)) {
        yaFallo.add(u);
        return respuesta(401, { code: 'UNAUTHENTICATED', detail: 'expiró' });
      }
      return respuesta(200, { ok: true, url: u });
    });

    await Promise.all([
      api('/a'), api('/b'), api('/c'), api('/d'), api('/e'),
    ]);

    expect(renovaciones).toBe(1);
  });

  it('si la renovación falla, se limpia el token y se avisa una sola vez', async () => {
    const { api, fijarToken, cuandoSePierdaLaSesion, hayToken } =
      await import('../src/api/cliente');
    fijarToken('viejo');

    let avisos = 0;
    cuandoSePierdaLaSesion(() => avisos++);

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      String(url).endsWith('/auth/refresh')
        ? respuesta(401, {})
        : respuesta(401, { code: 'UNAUTHENTICATED', detail: 'expiró' }),
    );

    await expect(api('/propiedades')).rejects.toThrow();

    // Silencioso sería peor: el usuario vería la app vacía sin saber por qué.
    expect(avisos).toBe(1);
    expect(hayToken()).toBe(false);
  });

  it('no reintenta en loop: un 401 después de renovar sale como error', async () => {
    const { api, fijarToken, cuandoSePierdaLaSesion } = await import('../src/api/cliente');
    fijarToken('viejo');
    cuandoSePierdaLaSesion(() => undefined);

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    let llamadas = 0;
    fetchMock.mockImplementation(async (url: string) => {
      llamadas++;
      if (String(url).endsWith('/auth/refresh')) return respuesta(200, { accessToken: 'nuevo' });
      return respuesta(401, { code: 'UNAUTHENTICATED', detail: 'sigue sin permiso' });
    });

    await expect(api('/propiedades')).rejects.toThrow();
    // request + refresh + reintento. Nada más: sin el flag `reintentado` esto
    // sería infinito y el navegador quedaría clavado.
    expect(llamadas).toBe(3);
  });

  it('el error trae el code estable y el requestId', async () => {
    const { api, ApiError } = await import('../src/api/cliente');
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      respuesta(500, { code: 'INTERNAL', detail: 'Ocurrió un error inesperado.',
                       requestId: 'req-123' }),
    );

    try {
      await api('/propiedades');
      throw new Error('tenía que fallar');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as InstanceType<typeof ApiError>;
      expect(err.code).toBe('INTERNAL');
      expect(err.requestId).toBe('req-123');
      // En un 5xx se muestra la referencia: es lo que convierte "me dio error"
      // en "ya lo veo".
      expect(err.paraMostrar).toContain('req-123');
    }
  });

  it('en un 4xx NO se muestra la referencia: el mensaje ya dice qué pasó', async () => {
    const { api, ApiError } = await import('../src/api/cliente');
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      respuesta(422, { code: 'SIN_INDICE', detail: 'Falta el IPC de marzo.',
                       requestId: 'req-456' }),
    );

    try {
      await api('/contratos');
      throw new Error('tenía que fallar');
    } catch (e) {
      const err = e as InstanceType<typeof ApiError>;
      expect(err.paraMostrar).toBe('Falta el IPC de marzo.');
      expect(err.paraMostrar).not.toContain('req-456');
    }
  });

  it('un 204 no intenta parsear un cuerpo vacío', async () => {
    const { api } = await import('../src/api/cliente');
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 204,
      headers: { get: () => null },
      json: async () => {
        throw new Error('no hay cuerpo');
      },
    } as unknown as Response);

    await expect(api('/algo')).resolves.toBeUndefined();
  });
});
