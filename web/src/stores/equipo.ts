import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../api/cliente';
import type { Rol } from '../dominio/roles';

export interface Miembro {
  usuarioId: string;
  nombre: string;
  email: string;
  rol: Rol;
  estado: string;
}

/**
 * El equipo de la inmobiliaria, cacheado por sesión.
 *
 * Existe porque el filtro por agente se monta en SEIS pantallas y todas
 * necesitan la misma lista: sin cache, entrar a Propiedades, a la cartera y a
 * Ventas son tres `GET /v1/equipo` idénticos para pintar el mismo desplegable.
 * No cambia entre pantallas y cambia muy poco entre días — sumar a alguien al
 * equipo es una invitación por mail, no una operación del minuto a minuto.
 *
 * `GET /v1/equipo` no tiene `@Roles`: cualquiera con sesión ve a sus
 * compañeros. No hay endpoint nuevo detrás de esto.
 *
 * Si la llamada falla NO se rompe la pantalla: `error` queda escrito y el
 * componente muestra el motivo en vez de un desplegable vacío que parece un
 * equipo de una persona.
 */
export const useEquipo = defineStore('equipo', () => {
  const miembros = ref<Miembro[]>([]);
  const cargado = ref(false);
  const cargando = ref(false);
  const error = ref('');

  /** Una sola llamada en vuelo aunque tres componentes la pidan a la vez. */
  let enVuelo: Promise<void> | null = null;

  async function cargar(forzar = false): Promise<void> {
    if (cargado.value && !forzar) return;
    if (enVuelo) return enVuelo;

    cargando.value = true;
    error.value = '';
    enVuelo = api<{ miembros: Miembro[] }>('/equipo')
      .then((r) => {
        miembros.value = r.miembros;
        cargado.value = true;
      })
      .catch(() => {
        error.value = 'No se pudo cargar el equipo.';
      })
      .finally(() => {
        cargando.value = false;
        enVuelo = null;
      });

    return enVuelo;
  }

  /**
   * Los que pueden aparecer en un filtro por agente.
   *
   * Sólo activos: alguien dado de baja no puede seguir ofreciéndose como opción
   * —sus propiedades siguen existiendo, pero elegirlo en el desplegable de un
   * listado de trabajo sugiere que sigue en la casa—. Se filtran igual **por
   * `estado`, no por rol**: quien capta una propiedad puede ser el titular o
   * administración, no sólo el rol `agente`. Filtrar por rol dejaría afuera al
   * dueño, que en una inmobiliaria chica es el que más capta.
   */
  const activos = computed(() => miembros.value.filter((m) => m.estado === 'activa'));

  /** El nombre de un uuid, para poder decir por quién está filtrada la lista. */
  function nombreDe(usuarioId: string | null | undefined): string | null {
    if (!usuarioId) return null;
    return miembros.value.find((m) => m.usuarioId === usuarioId)?.nombre ?? null;
  }

  /** Limpia el cache al cerrar sesión: el equipo es de la inmobiliaria. */
  function limpiar(): void {
    miembros.value = [];
    cargado.value = false;
    error.value = '';
  }

  return { miembros, activos, cargado, cargando, error, cargar, nombreDe, limpiar };
});
