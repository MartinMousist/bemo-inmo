import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
/**
 * Lo que la barra de arriba muestra del plan.
 *
 * `diasDePrueba` es la única cuenta regresiva REAL que existe: sale de
 * `prueba_hasta`. Un plan pago no tiene fecha de vencimiento en la base porque
 * no hay cobro integrado, y mostrar una inventada sería el peor dato posible.
 */
export interface PlanEnBarra {
  codigo: string;
  nombre: string | null;
  familia: string | null;
  estado: string | null;
  pruebaHasta: string | null;
  diasDePrueba: number | null;
}

import { api, fijarToken, renovar } from '../api/cliente';
import type { TipoCuenta } from '../dominio/roles';

export type Rol = 'owner' | 'admin' | 'agente' | 'contable';

interface Sesion {
  accessToken: string;
  usuario: { id: string; nombre: string };
  tenant: { id: string; nombre: string };
  rol: Rol;
}

export const useAuth = defineStore('auth', () => {
  const usuario = ref<Sesion['usuario'] | null>(null);
  const tenant = ref<Sesion['tenant'] | null>(null);
  const rol = ref<Rol | null>(null);
  const listo = ref(false);

  /**
   * Los módulos que esta cuenta tiene prendidos.
   *
   * Vive en el store y no en cada pantalla porque lo consume el MENÚ, que se
   * dibuja una vez por sesión y en cada navegación. `null` mientras no se
   * cargó: distinto de `[]`, que es un gestor sin ningún módulo opcional. Si
   * fueran lo mismo, la barra lateral parpadearía mostrando Ventas y Comisiones
   * medio segundo antes de esconderlas.
   */
  const modulos = ref<string[] | null>(null);

  /**
   * Inmobiliaria o gestión de alquileres.
   *
   * Lo consume el vocabulario —«Asesor» no significa nada donde no se vende— y
   * viene del mismo `GET /cuenta` que los módulos, sin un pedido de más.
   * `null` mientras no se sabe: ahí se usa el vocabulario de inmobiliaria, que
   * es el que ya estaba.
   */
  const tipoCuenta = ref<TipoCuenta | null>(null);

  /**
   * El plan, para la barra de arriba. Viene del MISMO `GET /cuenta` que los
   * módulos: la barra está en todas las pantallas y un pedido más por carga,
   * para dibujar dos palabras, se paga en cada navegación.
   */
  const plan = ref<PlanEnBarra | null>(null);

  const autenticado = computed(() => usuario.value !== null);

  /** Mientras no se sabe, se asume que sí: esconder de más es peor que de menos. */
  function tieneModulo(clave: string): boolean {
    return modulos.value === null || modulos.value.includes(clave);
  }

  async function cargarCuenta(): Promise<void> {
    try {
      const c = await api<{
        activos: string[]; tipo: TipoCuenta; plan: PlanEnBarra | null;
      }>('/cuenta');
      modulos.value = c.activos;
      tipoCuenta.value = c.tipo;
      plan.value = c.plan ?? null;
    } catch {
      // Si falla, se deja `null` y se ve todo. Una barra lateral vacía por un
      // error de red es peor que una con una entrada de más.
      modulos.value = null;
      tipoCuenta.value = null;
      plan.value = null;
    }
  }

  function guardar(s: Sesion): void {
    fijarToken(s.accessToken);
    usuario.value = s.usuario;
    tenant.value = s.tenant;
    rol.value = s.rol;
    void cargarCuenta();
  }

  function limpiar(): void {
    fijarToken(null);
    usuario.value = null;
    tenant.value = null;
    rol.value = null;
    modulos.value = null;
    tipoCuenta.value = null;
  }

  /**
   * Al cargar la app se intenta renovar con la cookie httpOnly. Si funciona,
   * el usuario ya estaba logueado y no ve la pantalla de login.
   */
  async function restaurar(): Promise<void> {
    // Un solo refresh —y por lo tanto una sola rotación de token— y después
    // /auth/yo para los nombres. Refrescar dos veces al arrancar rota de más
    // y ensucia la cadena de sesiones sin necesidad.
    if (await renovar()) {
      try {
        const yo = await api<Omit<Sesion, 'accessToken'>>('/auth/yo');
        usuario.value = yo.usuario;
        tenant.value = yo.tenant;
        rol.value = yo.rol;
        await cargarCuenta();
      } catch {
        limpiar();
      }
    }
    listo.value = true;
  }

  /**
   * Entrar.
   *
   * Devuelve `null` cuando la sesión quedó abierta, o el PASE cuando la cuenta
   * tiene segundo factor y falta el código. Se devuelve en vez de guardarse en
   * el store a propósito: es un dato de la pantalla de login —vive lo que dura
   * ese formulario— y meterlo acá lo dejaría dando vueltas después de entrar.
   */
  async function login(email: string, password: string): Promise<string | null> {
    const r = await api<Sesion | { requiereSegundoFactor: true; desafio: string }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    );

    if ('requiereSegundoFactor' in r) return r.desafio;

    guardar(r);
    return null;
  }

  /** El segundo paso: el código del teléfono, o uno de recuperación. */
  async function completarSegundoFactor(desafio: string, codigo: string): Promise<void> {
    guardar(
      await api<Sesion>('/auth/2fa', {
        method: 'POST',
        body: JSON.stringify({ desafio, codigo }),
      }),
    );
  }

  async function registrar(datos: {
    inmobiliaria: string;
    provincia?: string;
    email: string;
    password: string;
    nombre: string;
    /** `inmobiliaria` o `gestor`: decide con qué módulos arranca la cuenta. */
    tipo?: string;
  }): Promise<void> {
    guardar(
      await api<Sesion>('/auth/registrar', {
        method: 'POST',
        body: JSON.stringify(datos),
      }),
    );
  }

  /**
   * El estado local se limpia PRIMERO y recién después se avisa al servidor.
   *
   * Al revés no funciona: el guard del router corre antes de que vuelva la red,
   * ve la sesión todavía viva y rebota la navegación al login. Es el error #5
   * del playbook.
   */
  async function logout(): Promise<void> {
    limpiar();
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Si el servidor no contesta, la sesión local ya está cerrada igual.
    }
  }

  return {
    usuario,
    tenant,
    rol,
    listo,
    autenticado,
    modulos,
    tipoCuenta,
    plan,
    tieneModulo,
    cargarCuenta,
    restaurar,
    login,
    completarSegundoFactor,
    registrar,
    logout,
    limpiar,
  };
});
