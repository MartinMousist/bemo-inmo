export type Rol = 'owner' | 'admin' | 'agente' | 'contable';

/**
 * Los roles se muestran SIEMPRE con estas etiquetas. Una sola fuente: si la
 * topbar dice "Titular" y la tabla dice "owner", el usuario tiene que deducir
 * que son lo mismo.
 *
 * En la base y en la API viajan en inglés porque son valores de contrato; a la
 * pantalla no llegan nunca en crudo.
 */
export const ETIQUETA_ROL: Record<Rol, string> = {
  owner: 'Titular',
  admin: 'Administración',
  agente: 'Asesor',
  contable: 'Contable',
};

export function etiquetaRol(rol: string | null | undefined): string {
  return ETIQUETA_ROL[rol as Rol] ?? '—';
}

/** Los roles que un titular puede asignar al invitar. No puede crear otro titular. */
export const ROLES_INVITABLES: Rol[] = ['admin', 'agente', 'contable'];
