import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from './stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // La portada es pública y NO rebota a alguien con sesión abierta: querer
    // ver la página del producto estando logueado es legítimo.
    { path: '/', component: () => import('./paginas/LandingPage.vue'),
      meta: { publica: true, permiteSesion: true } },
    { path: '/login', component: () => import('./paginas/LoginPage.vue'), meta: { publica: true } },
    { path: '/registrar', component: () => import('./paginas/RegistrarPage.vue'), meta: { publica: true } },
    {
      path: '/invitacion/:token',
      component: () => import('./paginas/InvitacionPage.vue'),
      meta: { publica: true, permiteSesion: true },
    },

    { path: '/app', redirect: '/propiedades' },
    { path: '/propiedades', component: () => import('./paginas/PropiedadesPage.vue') },
    { path: '/propiedades/nueva', component: () => import('./paginas/PropiedadFormPage.vue') },
    { path: '/propiedades/:id/editar', component: () => import('./paginas/PropiedadFormPage.vue') },
    { path: '/propiedades/:id', component: () => import('./paginas/PropiedadDetallePage.vue') },
    { path: '/personas', component: () => import('./paginas/PersonasPage.vue') },
    { path: '/personas/nueva', component: () => import('./paginas/PersonaFormPage.vue') },
    { path: '/oportunidades', component: () => import('./paginas/OportunidadesPage.vue') },
    { path: '/oportunidades/nueva', component: () => import('./paginas/OportunidadFormPage.vue') },
    { path: '/reservas', component: () => import('./paginas/ReservasPage.vue') },
    { path: '/vencimientos', component: () => import('./paginas/VencimientosPage.vue') },
    { path: '/contratos', component: () => import('./paginas/ContratosPage.vue') },
    { path: '/contratos/nuevo', component: () => import('./paginas/ContratoFormPage.vue') },
    { path: '/contratos/:id', component: () => import('./paginas/ContratoDetallePage.vue') },
    { path: '/liquidaciones', component: () => import('./paginas/LiquidacionesPage.vue') },
    { path: '/indices', component: () => import('./paginas/IndicesPage.vue') },
    { path: '/ventas', component: () => import('./paginas/VentasPage.vue') },
    { path: '/publicaciones', component: () => import('./paginas/PublicacionesPage.vue') },
    { path: '/avisos', component: () => import('./paginas/AvisosPage.vue') },
    { path: '/equipo', component: () => import('./paginas/EquipoPage.vue') },
    { path: '/plan', component: () => import('./paginas/PlanPage.vue') },

    { path: '/:resto(.*)*', component: () => import('./paginas/NoEncontradaPage.vue') },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

/**
 * Guard de rutas. Por defecto TODO exige sesión; una ruta es pública sólo si lo
 * declara. Igual que en el backend: el olvido deja la puerta cerrada, no abierta.
 */
router.beforeEach(async (to) => {
  const auth = useAuth();
  if (!auth.listo) await auth.restaurar();

  if (to.meta.publica) {
    // Si ya está adentro, no tiene sentido mostrarle el login…
    // …salvo en la invitación: alguien logueado puede abrir una invitación a
    // otra inmobiliaria, y rebotarlo dejaría el enlace inservible.
    if (auth.autenticado && !to.meta.permiteSesion) return { path: '/' };
    return true;
  }

  if (!auth.autenticado) {
    // `next` para volver adonde quería ir, en vez de tirarlo al inicio.
    return { path: '/login', query: { next: to.fullPath } };
  }
  return true;
});

export default router;
