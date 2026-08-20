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
    // El del inquilino, con las mismas reglas: público, con el token en la URL,
    // y `permiteSesion` para que un empleado vea exactamente lo que ve él.
    {
      path: '/inquilino/:token',
      component: () => import('./paginas/PortalInquilinoPage.vue'),
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
    // Literal, y ANTES de `/:id`: `comparar` no es el id de nada.
    { path: '/propiedades/comparar', component: () => import('./paginas/CompararPage.vue') },
    // Antes de `/:id`: si fuera después, «ficha» entraría como id de propiedad.
    // Es la misma lección que ya dejaron escrita venta y alquiler.
    {
      path: '/propiedades/:id/ficha',
      component: () => import('./paginas/PropiedadFichaPage.vue'),
    },
    { path: '/propiedades/:id', component: () => import('./paginas/PropiedadDetallePage.vue') },
    { path: '/personas', component: () => import('./paginas/PersonasPage.vue') },
    { path: '/personas/nueva', component: () => import('./paginas/PersonaFormPage.vue') },
    // DESPUÉS del literal `/personas/nueva`, que es la lección que ya dejaron
    // escrita venta y alquiler: con `/:id` declarado antes, «nueva» entraría
    // como id y la pantalla pediría una persona que no existe.
    {
      path: '/personas/:id/cuenta',
      component: () => import('./paginas/CuentaCorrientePage.vue'),
    },
    // Las tres pantallas de personas por rol. Son listas, no fichas: si algún
    // día llevan `/:id`, va DECLARADO DESPUÉS del literal, que es la lección
    // que venta y alquiler ya dejaron escrita veinte líneas más arriba.
    { path: '/inquilinos', component: () => import('./paginas/InquilinosPage.vue') },
    { path: '/propietarios', component: () => import('./paginas/PropietariosPage.vue') },
    { path: '/garantes', component: () => import('./paginas/GarantesPage.vue') },
    // «Leads» es como se llama en una inmobiliaria. En la base y en la API sigue
    // siendo `oportunidad`: renombrar una tabla, su endpoint y sus tests para
    // cambiar una etiqueta de pantalla es mover cañerías por un cartel.
    { path: '/leads', component: () => import('./paginas/OportunidadesPage.vue') },
    { path: '/leads/nueva', component: () => import('./paginas/OportunidadFormPage.vue') },
    // Las rutas viejas siguen andando: alguien tiene el enlace guardado.
    { path: '/oportunidades', redirect: '/leads' },
    { path: '/oportunidades/nueva', redirect: '/leads/nueva' },
    { path: '/reservas', component: () => import('./paginas/ReservasPage.vue') },
    { path: '/agenda', component: () => import('./paginas/AgendaPage.vue') },
    { path: '/vencimientos', component: () => import('./paginas/VencimientosPage.vue') },
    { path: '/contratos', component: () => import('./paginas/ContratosPage.vue') },
    { path: '/contratos/nuevo', component: () => import('./paginas/ContratoFormPage.vue') },
    { path: '/contratos/:id', component: () => import('./paginas/ContratoDetallePage.vue') },
    // La hoja imprimible de un documento generado. Ruta propia y no un modal:
    // el `@media print` global esconde botones y navegación pero imprime todo
    // el resto de la página, así que desde la ficha del contrato saldrían atrás
    // del pre-contrato los aumentos, las cuotas y los garantes.
    //
    // Con sesión, como todo lo que no se declara público: el pre-contrato lleva
    // los DNI y los domicilios de las partes. No es un enlace para compartir.
    {
      path: '/documentos/:id/imprimir',
      component: () => import('./paginas/DocumentoImprimirPage.vue'),
    },
    { path: '/liquidaciones', component: () => import('./paginas/LiquidacionesPage.vue') },
    { path: '/caja', component: () => import('./paginas/CajaPage.vue') },
    { path: '/conciliacion', component: () => import('./paginas/ConciliacionPage.vue') },
    { path: '/movimientos', component: () => import('./paginas/AuditoriaPage.vue') },
    { path: '/indices', component: () => import('./paginas/IndicesPage.vue') },
    { path: '/ventas', component: () => import('./paginas/VentasPage.vue') },
    // Faltaba: la fila de VentasPage navegaba acá desde el primer día y caía en
    // NoEncontradaPage. Sin esta ruta, la mitad de la etapa de comisiones —de
    // quién es cada peso de una venta— no tenía dónde vivir.
    { path: '/ventas/:id', component: () => import('./paginas/VentaDetallePage.vue') },
    { path: '/publicaciones', component: () => import('./paginas/PublicacionesPage.vue') },
    { path: '/avisos', component: () => import('./paginas/AvisosPage.vue') },
    { path: '/equipo', component: () => import('./paginas/EquipoPage.vue') },
    // El perfil de una persona del equipo: sus números, sus captaciones y sus
    // operaciones. Los montos los filtra el back según quién mira.
    { path: '/equipo/:usuarioId', component: () => import('./paginas/AgentePage.vue') },
    { path: '/comisiones', component: () => import('./paginas/ComisionesPage.vue') },
    { path: '/plan', component: () => import('./paginas/PlanPage.vue') },
    { path: '/cuenta', component: () => import('./paginas/CuentaPage.vue') },
    // Sin restricción de rol: cada persona administra la seguridad de SU cuenta,
    // y el asesor que entra desde el teléfono la necesita igual que el titular.
    { path: '/seguridad', component: () => import('./paginas/SeguridadPage.vue') },
    { path: '/inbox', component: () => import('./paginas/InboxPage.vue') },
    { path: '/canales', component: () => import('./paginas/CanalesPage.vue') },
    { path: '/bot', component: () => import('./paginas/BotConfigPage.vue') },
    { path: '/importar', component: () => import('./paginas/ImportarPage.vue') },

    { path: '/:resto(.*)*', component: () => import('./paginas/NoEncontradaPage.vue') },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

/**
 * Qué prefijo de ruta pertenece a qué módulo apagable.
 *
 * Va por prefijo y no por ruta exacta a propósito: `/ventas/:id` y
 * `/leads/nueva` tienen que caer con su sección. El catálogo de módulos vive en
 * el backend (`cuenta/modulos.motor.ts`); acá está sólo el mapa a rutas del
 * front, que es lo que el backend no sabe.
 */
const RUTA_DE_MODULO: Array<[string, string]> = [
  ['/leads', 'leads'],
  ['/oportunidades', 'leads'],
  ['/ventas', 'ventas'],
  ['/comisiones', 'comisiones'],
  ['/publicaciones', 'publicaciones'],
  ['/reservas', 'reservas'],
];

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

  // Un módulo apagado no está sólo fuera del menú: su ruta tampoco existe.
  // Filtrar únicamente la barra lateral dejaría la pantalla accesible tipeando
  // la URL o con un enlace viejo, y entonces la cuenta de gestión de alquileres
  // seguiría teniendo Ventas — escondida, que es peor que visible.
  const modulo = RUTA_DE_MODULO.find(([prefijo]) => to.path.startsWith(prefijo));
  if (modulo && !auth.tieneModulo(modulo[1])) return { path: '/inicio' };

  return true;
});

export default router;
