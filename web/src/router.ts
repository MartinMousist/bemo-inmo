import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from './stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // `/` es la portada para quien no tiene sesión, y el inicio de la app para
    // quien sí (lo resuelve el guard de abajo). La portada queda igual accesible
    // en `/producto`: querer ver la página del producto estando logueado es
    // legítimo, y era lo que hacía antes esta ruta.
    { path: '/', component: () => import('./paginas/LandingPage.vue'),
      meta: { publica: true, permiteSesion: true } },
    { path: '/producto', component: () => import('./paginas/LandingPage.vue'),
      meta: { publica: true, permiteSesion: true } },
    { path: '/login', component: () => import('./paginas/LoginPage.vue'), meta: { publica: true } },

    // El portal del propietario. Público y con el token en la URL: quien lo abre
    // NO tiene sesión y no tiene por qué tenerla. `permiteSesion` para que un
    // empleado pueda abrirlo y ver exactamente lo que ve el dueño.
    {
      path: '/propietario/:token',
      component: () => import('./paginas/PortalPropietarioPage.vue'),
      meta: { publica: true, permiteSesion: true },
    },
    { path: '/registrar', component: () => import('./paginas/RegistrarPage.vue'), meta: { publica: true } },
    {
      path: '/invitacion/:token',
      component: () => import('./paginas/InvitacionPage.vue'),
      meta: { publica: true, permiteSesion: true },
    },

    { path: '/app', redirect: '/inicio' },
    { path: '/inicio', component: () => import('./paginas/InicioPage.vue') },
    { path: '/tablero', component: () => import('./paginas/TableroPage.vue') },
    { path: '/reclamos', component: () => import('./paginas/ReclamosPage.vue') },
    { path: '/gastos', component: () => import('./paginas/GastosPage.vue') },
    { path: '/plantillas', component: () => import('./paginas/PlantillasPage.vue') },
    // Las dos carteras van ANTES de `/propiedades/:id`: Vue Router resuelve por
    // orden de declaración y si no, `venta` se leería como un id.
    { path: '/propiedades/venta', component: () => import('./paginas/CarteraPropiedadesPage.vue') },
    { path: '/propiedades/alquiler', component: () => import('./paginas/CarteraPropiedadesPage.vue') },
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
    { path: '/caja', component: () => import('./paginas/CajaPage.vue') },
    { path: '/movimientos', component: () => import('./paginas/AuditoriaPage.vue') },
    { path: '/indices', component: () => import('./paginas/IndicesPage.vue') },
    { path: '/ventas', component: () => import('./paginas/VentasPage.vue') },
    { path: '/publicaciones', component: () => import('./paginas/PublicacionesPage.vue') },
    { path: '/avisos', component: () => import('./paginas/AvisosPage.vue') },
    { path: '/equipo', component: () => import('./paginas/EquipoPage.vue') },
    { path: '/plan', component: () => import('./paginas/PlanPage.vue') },
    { path: '/importar', component: () => import('./paginas/ImportarPage.vue') },

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
    // Con sesión abierta, la raíz es el tablero del día y no la portada. Es la
    // primera pregunta de quien abre el sistema a la mañana: qué hay que hacer
    // hoy. La portada sigue en `/producto` para quien la quiera ver.
    if (auth.autenticado && to.path === '/') return { path: '/inicio' };

    // Si ya está adentro, no tiene sentido mostrarle el login…
    // …salvo en la invitación: alguien logueado puede abrir una invitación a
    // otra inmobiliaria, y rebotarlo dejaría el enlace inservible.
    if (auth.autenticado && !to.meta.permiteSesion) return { path: '/inicio' };
    return true;
  }

  if (!auth.autenticado) {
    // `next` para volver adonde quería ir, en vez de tirarlo al inicio.
    return { path: '/login', query: { next: to.fullPath } };
  }
  return true;
});

export default router;
