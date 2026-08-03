export type Preferencia = 'claro' | 'oscuro' | 'sistema';
export type TemaEfectivo = 'light' | 'dark';

const CLAVE = 'bemo-inmo:theme';

const consulta = window.matchMedia('(prefers-color-scheme: dark)');

export function leerPreferencia(): Preferencia {
  const v = localStorage.getItem(CLAVE);
  if (v === 'claro' || v === 'oscuro' || v === 'sistema') return v;
  // Migración: antes se guardaba el tema EFECTIVO ('light'/'dark'), no la
  // preferencia. Sin esto, alguien que había elegido oscuro volvía a claro.
  if (v === 'dark') return 'oscuro';
  if (v === 'light') return 'claro';
  return 'sistema';
}

export function resolver(p: Preferencia): TemaEfectivo {
  if (p === 'claro') return 'light';
  if (p === 'oscuro') return 'dark';
  return consulta.matches ? 'dark' : 'light';
}

export function aplicar(p: Preferencia): TemaEfectivo {
  const efectivo = resolver(p);
  document.documentElement.setAttribute('data-theme', efectivo);
  localStorage.setItem(CLAVE, p);
  return efectivo;
}

/**
 * Con la preferencia en "sistema" hay que seguir escuchando: si el usuario
 * cambia el tema del SO mientras la app está abierta, la app tiene que
 * acompañarlo. Sin esto, "sistema" sería sólo "lo que el sistema decía cuando
 * cargué la página".
 */
export function escucharSistema(alCambiar: (t: TemaEfectivo) => void): () => void {
  const handler = () => {
    if (leerPreferencia() === 'sistema') {
      const t = resolver('sistema');
      document.documentElement.setAttribute('data-theme', t);
      alCambiar(t);
    }
  };
  consulta.addEventListener('change', handler);
  return () => consulta.removeEventListener('change', handler);
}
