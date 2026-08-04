import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

/**
 * Avisos y confirmaciones de la app.
 *
 * Dos cosas que faltaban y se notaban:
 *
 * 1. **Los resultados no se veían.** El error se mostraba como un bloque rojo
 *    adentro de la página y el éxito no se mostraba en ningún lado: registrar un
 *    cobro y que no pase nada visible deja al usuario sin saber si entró.
 *
 * 2. **Nada destructivo pedía confirmación.** Borrar una propiedad, una persona
 *    o una foto se ejecutaba al primer clic.
 *
 * El toast lleva **detalle**, no sólo "Guardado": en un producto que mueve plata,
 * *"Cobro registrado · ARS 485.000"* es la confirmación de que entró el número
 * correcto, y es lo que permite darse cuenta de un cero de más en el momento y
 * no a fin de mes.
 */

export type TonoToast = 'ok' | 'err' | 'info';

export interface Toast {
  id: number;
  tono: TonoToast;
  titulo: string;
  detalle?: string;
}

export interface PedidoConfirmacion {
  titulo: string;
  detalle?: string;
  /** Texto del botón que ejecuta. Que diga QUÉ hace, no "Aceptar". */
  confirmar?: string;
  cancelar?: string;
  /** Pinta el botón en rojo. Para lo que no tiene vuelta atrás. */
  peligroso?: boolean;
  /**
   * Si viene, hay que tipear exactamente esto para habilitar el botón. Se usa
   * cuando lo que se borra arrastra otras cosas: una propiedad se lleva sus
   * operaciones, sus fotos y su historial.
   */
  escribir?: string;
}

/** Cuánto vive un toast. El de error dura más: suele haber algo que leer. */
const VIDA_MS: Record<TonoToast, number> = { ok: 4000, info: 5000, err: 8000 };

export const useUi = defineStore('ui', () => {
  const toasts = ref<Toast[]>([]);
  let proximoId = 1;

  const confirmacion = ref<PedidoConfirmacion | null>(null);
  // `shallowRef` a propósito: es una función, no un dato reactivo.
  const resolver = shallowRef<((ok: boolean) => void) | null>(null);

  function toast(tono: TonoToast, titulo: string, detalle?: string): number {
    const id = proximoId++;
    toasts.value.push({ id, tono, titulo, detalle });
    // El timer se cancela solo al cerrar a mano porque `cerrarToast` es
    // idempotente: si el id ya no está, el filter no hace nada.
    setTimeout(() => cerrarToast(id), VIDA_MS[tono]);
    return id;
  }

  const ok = (titulo: string, detalle?: string) => toast('ok', titulo, detalle);
  const error = (titulo: string, detalle?: string) => toast('err', titulo, detalle);
  const info = (titulo: string, detalle?: string) => toast('info', titulo, detalle);

  function cerrarToast(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  /**
   * `await ui.confirmar({...})` → `true` si el usuario aceptó.
   *
   * Es una promesa y no un callback para que el código que borra se lea de
   * arriba abajo: `if (!(await ui.confirmar(...))) return;` y sigue.
   */
  function confirmar(pedido: PedidoConfirmacion): Promise<boolean> {
    // Si ya había una abierta, la anterior se resuelve en `false`. Dejarla
    // colgada filtraría una promesa que nunca se cumple.
    resolver.value?.(false);

    confirmacion.value = pedido;
    return new Promise<boolean>((resolve) => {
      resolver.value = resolve;
    });
  }

  function responder(acepta: boolean): void {
    resolver.value?.(acepta);
    resolver.value = null;
    confirmacion.value = null;
  }

  return {
    toasts, toast, ok, error, info, cerrarToast,
    confirmacion, confirmar, responder,
  };
});
