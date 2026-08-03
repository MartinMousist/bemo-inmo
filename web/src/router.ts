import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from './stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('./paginas/LoginPage.vue'),
      meta: { publica: true },
    },
    {
      path: '/registrar',
      name: 'registrar',
      component: () => import('./paginas/RegistrarPage.vue'),
      meta: { publica: true },
    },
    {
      path: '/invitacion/:token',
      name: 'invitacion',
      component: () => import('./paginas/InvitacionPage.vue'),
      meta: { publica: true, permiteSesion: true },
    },
    {
      path: '/',
      name: 'equipo',
      component: () => import('./paginas/EquipoPage.vue'),
    },
  ],
});

/**
 * Guard de rutas. Por defecto TODO exige sesión; una ruta es pública sólo si lo
 * declara. Igual que en el backend: el olvido deja la puerta cerrada, no abierta.
 */
router.beforeEach(async (to) => {
  const auth = useAuth();

  // Al primer navigate todavía no se intentó restaurar la sesión desde la cookie.
  if (!auth.listo) await auth.restaurar();

  if (to.meta.publica) {
    // Si ya está adentro, no tiene sentido mostrarle el login…
    // …salvo en la invitación: alguien puede estar logueado con una cuenta y
    // abrir una invitación a otra inmobiliaria. Rebotarlo al inicio le dejaría
    // el enlace inservible sin explicación.
    if (auth.autenticado && !to.meta.permiteSesion) return { path: '/' };
    return true;
  }

  if (!auth.autenticado) {
    // `next` para volver adonde quería ir, en vez de tirarlo al inicio.
    return { path: '/login', query: to.fullPath === '/' ? {} : { next: to.fullPath } };
  }

  return true;
});

export default router;
