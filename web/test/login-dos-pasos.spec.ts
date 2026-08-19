import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { useAuth } from '../src/stores/auth';

/**
 * El login cuando la cuenta tiene segundo factor.
 *
 * Lo que se prueba es la decisión que hace el store, que es la que puede
 * romperse en silencio: **con segundo factor NO se guarda nada**. Si el store
 * tratara la respuesta del primer paso como una sesión, el guard dejaría entrar
 * a alguien que todavía no presentó el código —y la app se vería «funcionando»
 * mientras cada request contesta 401—.
 */
describe('login con segundo factor', () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    vi.restoreAllMocks();
  });

  function responder(cuerpo: unknown) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => cuerpo,
      text: async () => JSON.stringify(cuerpo),
    }) as unknown as typeof fetch;
  }

  it('devuelve el pase y NO deja la sesión abierta', async () => {
    responder({ requiereSegundoFactor: true, desafio: 'pase-firmado' });

    const auth = useAuth();
    const pase = await auth.login('ana@inmo.test', 'unaclavelarga1');

    expect(pase).toBe('pase-firmado');
    // Lo importante: nadie quedó logueado. Se mira `autenticado`, que es lo que
    // consulta el guard del router —el token no se expone a propósito: vive en
    // el módulo y no en la superficie del store—.
    expect(auth.autenticado).toBe(false);
    expect(auth.usuario).toBeNull();
  });

  it('sin segundo factor devuelve null y sí abre la sesión', async () => {
    responder({
      accessToken: 'un-token',
      usuario: { id: 'u1', nombre: 'Ana' },
      tenant: { id: 't1', nombre: 'Andes' },
      rol: 'owner',
    });

    const auth = useAuth();
    const pase = await auth.login('ana@inmo.test', 'unaclavelarga1');

    expect(pase).toBeNull();
    expect(auth.usuario?.nombre).toBe('Ana');
  });

  it('el segundo paso abre la sesión con lo que devuelve /auth/2fa', async () => {
    responder({
      accessToken: 'token-tras-codigo',
      usuario: { id: 'u1', nombre: 'Ana' },
      tenant: { id: 't1', nombre: 'Andes' },
      rol: 'owner',
    });

    const auth = useAuth();
    await auth.completarSegundoFactor('pase-firmado', '123456');

    expect(auth.autenticado).toBe(true);
    expect(auth.rol).toBe('owner');
    expect(auth.usuario?.nombre).toBe('Ana');
  });
});
