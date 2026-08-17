export type Rol = 'owner' | 'admin' | 'agente' | 'contable';

/**
 * Los roles se muestran SIEMPRE con estas etiquetas. Una sola fuente: si la
 * topbar dice "Titular" y la tabla dice "owner", el usuario tiene que deducir
 * que son lo mismo.
 *
 * En la base y en la API viajan en inglés porque son valores de contrato; a la
 * pantalla no llegan nunca en crudo.
 */
export type TipoCuenta = 'inmobiliaria' | 'gestor';

export const ETIQUETA_ROL: Record<Rol, string> = {
  owner: 'Titular',
  admin: 'Administración',
  agente: 'Asesor',
  contable: 'Contable',
};

/**
 * Lo que cambia de nombre cuando la cuenta no vende.
 *
 * **Es una etiqueta, no un rol nuevo.** En la base siguen siendo los mismos
 * cuatro valores del CHECK, con la misma matriz de permisos probada endpoint
 * por endpoint. Agregar un quinto rol para decir «colaborador» multiplicaría
 * esa matriz —y se paga en cada feature futura— a cambio de una palabra.
 *
 * Sólo `agente` cambia: «Asesor» es alguien que asesora en una compra. Quien
 * administra veinte departamentos no tiene asesores, tiene quien lo ayuda a
 * gestionar. Titular, Administración y Contable significan lo mismo en los dos.
 */
const ETIQUETA_ROL_GESTOR: Partial<Record<Rol, string>> = {
  agente: 'Colaborador',
};

export function etiquetaRol(
  rol: string | null | undefined,
  tipo?: TipoCuenta | null,
): string {
  const r = rol as Rol;
  // Sin tipo conocido se usa el vocabulario de inmobiliaria, que es el que ya
  // estaba: mientras `GET /cuenta` viaja, el chip no debe parpadear.
  if (tipo === 'gestor' && ETIQUETA_ROL_GESTOR[r]) return ETIQUETA_ROL_GESTOR[r] as string;
  return ETIQUETA_ROL[r] ?? '—';
}

/** Los roles que un titular puede asignar al invitar. No puede crear otro titular. */
export const ROLES_INVITABLES: Rol[] = ['admin', 'agente', 'contable'];
