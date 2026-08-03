const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/v1';

/** Error con el `code` estable del contrato RFC 9457. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;

export function fijarToken(token: string | null): void {
  // El access token vive SÓLO en memoria. En localStorage lo alcanzaría
  // cualquier XSS, y sobreviviría a cerrar la pestaña.
  accessToken = token;
}

export function hayToken(): boolean {
  return accessToken !== null;
}

/**
 * Renovación single-flight.
 *
 * Si cinco requests fallan a la vez con 401, se renueva UNA sola vez y las cinco
 * esperan a esa misma promesa. Sin esto, cinco refresh en paralelo rotan el token
 * cinco veces: cuatro quedan con un token ya consumido y el backend lo interpreta
 * —correctamente— como reuso, y cierra todas las sesiones del usuario.
 */
let renovacionEnCurso: Promise<boolean> | null = null;

async function renovar(): Promise<boolean> {
  renovacionEnCurso ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const datos = await res.json();
      accessToken = datos.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      // Se libera en el próximo tick para que todos los que esperaban lean el
      // token ya actualizado antes de que otro ciclo pueda empezar.
      queueMicrotask(() => {
        renovacionEnCurso = null;
      });
    }
  })();

  return renovacionEnCurso;
}

export type AlPerderSesion = () => void;
let alPerderSesion: AlPerderSesion = () => undefined;

export function cuandoSePierdaLaSesion(fn: AlPerderSesion): void {
  alPerderSesion = fn;
}

export async function api<T = unknown>(
  ruta: string,
  opciones: RequestInit & { reintentado?: boolean } = {},
): Promise<T> {
  const { reintentado, ...init } = opciones;

  const res = await fetch(`${BASE}${ruta}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401 && !reintentado) {
    if (await renovar()) {
      return api<T>(ruta, { ...opciones, reintentado: true });
    }
    accessToken = null;
    alPerderSesion();
  }

  if (!res.ok) {
    const problema = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      problema?.code ?? 'DESCONOCIDO',
      problema?.detail ?? `Error ${res.status}`,
    );
  }

  return res.status === 204 ? (undefined as T) : res.json();
}

export { renovar };
