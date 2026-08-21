import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LimiteIntentosGuard, opcionesDeLimite } from './auth/limite-intentos';
import { LimiteStoragePostgres } from './auth/limite-storage';
import { DatabaseModule } from './database/database.module';
import { DbService } from './database/db.service';
import { HealthController } from './health/health.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { TokensService } from './auth/tokens.service';
import { AuthGuard } from './auth/auth.guard';
import { ModuloGuard } from './planes/modulo.guard';
import { EquipoController } from './equipo/equipo.controller';
import { EquipoService } from './equipo/equipo.service';
import { PersonasController } from './personas/personas.controller';
import { PersonasService } from './personas/personas.service';
import { CuentaCorrienteService } from './personas/cuenta-corriente.service';
import { RolesPersonaController } from './personas/roles.controller';
import { InquilinosService } from './personas/inquilinos.service';
import { PropietariosService } from './personas/propietarios.service';
import { PropiedadesController } from './propiedades/propiedades.controller';
import { PropiedadesService } from './propiedades/propiedades.service';
import { GeocodingService } from './propiedades/geocoding.service';
import {
  OportunidadesController,
  ReservasController,
} from './oportunidades/oportunidades.controller';
import { OportunidadesService } from './oportunidades/oportunidades.service';
import {
  AjustesController,
  CobrosController,
  ContratosController,
  CuotasController,
  IndicesController,
  LiquidacionesController,
} from './alquileres/alquileres.controller';
import { ContratosService } from './alquileres/contratos.service';
import { CarteraService } from './alquileres/cartera.service';
import { CicloService } from './alquileres/ciclo.service';
import { AuditoriaController } from './auditoria/auditoria.controller';
import { AuditoriaService } from './auditoria/auditoria.service';
import { IndicesService } from './alquileres/indices.service';
import { CotizacionesService } from './alquileres/cotizaciones.service';
import { CotizacionesController } from './alquileres/cotizaciones.controller';
import { IndicesCron } from './alquileres/indices.cron';
import { BcraService } from './alquileres/bcra.service';
import { LiquidacionesService } from './alquileres/liquidaciones.service';
import {
  ComisionesController,
  ComisionesDeContratoController,
  VentasController,
} from './ventas/ventas.controller';
import { VentasService } from './ventas/ventas.service';
import { ComisionesConfigService } from './ventas/comisiones.config.service';
import { ExternasService } from './ventas/externas.service';
import { ComisionesContratoService } from './ventas/comisiones.contrato.service';
import { GaranteController, GarantesController } from './garantes/garantes.controller';
import { GarantesService } from './garantes/garantes.service';
import { DeudoresService } from './garantes/deudores.service';
import {
  FeedController,
  PublicacionesController,
} from './publicaciones/publicaciones.controller';
import { PublicacionesService } from './publicaciones/publicaciones.service';
import { RecordatoriosController } from './recordatorios/recordatorios.controller';
import { RecordatoriosService } from './recordatorios/recordatorios.service';
import { ExportarController } from './exportar/exportar.controller';
import { ExportarService } from './exportar/exportar.service';
import {
  ApiKeysController,
  PlanesController,
  SucursalesController,
} from './planes/planes.controller';
import { PlanesService } from './planes/planes.service';
import { ImportarController } from './importar/importar.controller';
import { ImportarService } from './importar/importar.service';
import { FotosController } from './archivos/fotos.controller';
import { FotosService } from './archivos/fotos.service';
import { AlmacenamientoService } from './archivos/almacenamiento.service';
import { PlantillasController } from './plantillas/plantillas.controller';
import { PlantillasService } from './plantillas/plantillas.service';
import {
  DocumentosController,
  DocumentosDeContratoController,
} from './plantillas/documentos.controller';
import { DocumentosService } from './plantillas/documentos.service';
import { CajaController, InicioController } from './inicio/inicio.controller';
import { CajaService } from './inicio/caja.service';
import {
  GastosController, ProveedoresController, ReclamosController,
} from './gastos/gastos.controller';
import { GastosService } from './gastos/gastos.service';
import { ReclamosService } from './gastos/reclamos.service';
import { TableroController } from './tablero/tablero.controller';
import { TableroService } from './tablero/tablero.service';
import { NotasController } from './notas/notas.controller';
import { NotasService } from './notas/notas.service';
import {
  AccesosInquilinoController,
  AccesosPropietarioController,
  PortalController,
  PortalInquilinoController,
} from './portal/portal.controller';
import { PortalService } from './portal/portal.service';
import { InicioService } from './inicio/inicio.service';
import { ConciliacionController } from './conciliacion/conciliacion.controller';
import { ConciliacionService } from './conciliacion/conciliacion.service';
import { ActasController, ActasDeContratoController } from './actas/actas.controller';
import { ActasService } from './actas/actas.service';
import { CuentaController } from './cuenta/cuenta.controller';
import { SeguridadController } from './cuenta/seguridad.controller';
import { RetencionController } from './datos-personales/retencion.controller';
import { RetencionService } from './datos-personales/retencion.service';
import { EmailAdaptador } from './inbox/adaptadores/email.adaptador';
import { MetaAdaptador } from './inbox/adaptadores/meta.adaptador';
import { RegistroAdaptadores } from './inbox/adaptadores/registro';
import { CanalesController } from './inbox/canales.controller';
import { CanalesService } from './inbox/canales.service';
import { InboxController } from './inbox/inbox.controller';
import { InboxService } from './inbox/inbox.service';
import { IngestaService } from './inbox/ingesta.service';
import { WebhooksController } from './inbox/webhooks.controller';
import { BotController, RespuestasController } from './inbox/plantillas.controller';
import { BotService } from './inbox/bot.service';
import { PlantillasChatService } from './inbox/plantillas.service';
import {
  EmprendimientosController, PlanesPagoController,
} from './emprendimientos/emprendimientos.controller';
import { EmprendimientosService } from './emprendimientos/emprendimientos.service';
import { ImportarUnidadesService } from './emprendimientos/importar-unidades.service';
import { PlanesPagoService } from './emprendimientos/planes.service';
import { RedController } from './red/red.controller';
import { RedService } from './red/red.service';
import { EnviosController, SeleccionPublicaController } from './envios/envios.controller';
import { EnviosService } from './envios/envios.service';
import { TelegramAdaptador } from './inbox/adaptadores/telegram.adaptador';
import { TwilioAdaptador } from './inbox/adaptadores/twilio.adaptador';
import { TotpService } from './auth/totp.service';
import { CuentaService } from './cuenta/cuenta.service';

@Module({
  // El límite de intentos NO va como guard global: sólo lo aplica AuthController
  // con @UseGuards. Un tope global de dos dígitos por ventana rompería el uso
  // normal de la app, que hace decenas de requests por pantalla.
  imports: [
    DatabaseModule,
    // El storage del contador va inyectado: en producción es una tabla —para que
    // dos réplicas compartan la cuenta— y en desarrollo es memoria.
    ThrottlerModule.forRootAsync({
      imports: [DatabaseModule],
      inject: [DbService],
      useFactory: (db: DbService) => ({
        ...opcionesDeLimite,
        storage: new LimiteStoragePostgres(db),
      }),
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    InicioController,
    CajaController,
    TableroController,
    GastosController,
    ProveedoresController,
    ReclamosController,
    AuditoriaController,
    NotasController,
    AccesosPropietarioController,
    PortalController,
    AccesosInquilinoController,
    PortalInquilinoController,
    ConciliacionController,
    ActasDeContratoController,
    ActasController,
    CuentaController,
    SeguridadController,
    RetencionController,
    WebhooksController,
    InboxController,
    CanalesController,
    RespuestasController,
    BotController,
    RedController,
    EnviosController,
    SeleccionPublicaController,
    EmprendimientosController,
    PlanesPagoController,
    EquipoController,
    PersonasController,
    RolesPersonaController,
    PropiedadesController,
    OportunidadesController,
    ReservasController,
    ContratosController,
    AjustesController,
    CuotasController,
    CobrosController,
    IndicesController,
    CotizacionesController,
    LiquidacionesController,
    VentasController,
    ComisionesController,
    ComisionesDeContratoController,
    GarantesController,
    GaranteController,
    PublicacionesController,
    FeedController,
    RecordatoriosController,
    ExportarController,
    PlanesController,
    SucursalesController,
    ApiKeysController,
    ImportarController,
    FotosController,
    PlantillasController,
    DocumentosDeContratoController,
    DocumentosController,
  ],
  providers: [
    RedService,
    EnviosService,
    AuthService,
    TokensService,
    InicioService,
    CajaService,
    TableroService,
    GastosService,
    ReclamosService,
    NotasService,
    PortalService,
    ConciliacionService,
    ActasService,
    CuentaService,
    EquipoService,
    PersonasService,
    CuentaCorrienteService,
    InquilinosService,
    PropietariosService,
    PropiedadesService,
    GeocodingService,
    OportunidadesService,
    ContratosService,
    CarteraService,
    CicloService,
    AuditoriaService,
    IndicesService,
    CotizacionesService,
    IndicesCron,
    BcraService,
    LiquidacionesService,
    VentasService,
    ComisionesConfigService,
    ExternasService,
    ComisionesContratoService,
    GarantesService,
    DeudoresService,
    PublicacionesService,
    RecordatoriosService,
    ExportarService,
    PlanesService,
    ImportarService,
    FotosService,
    AlmacenamientoService,
    PlantillasService,
    DocumentosService,
    // Guard GLOBAL: todo exige token salvo lo marcado con @Publico().
    // Si fuera opt-in, un endpoint nuevo sin decorador quedaría abierto.
    TotpService,
    RetencionService,
    TelegramAdaptador,
    TwilioAdaptador,
    MetaAdaptador,
    EmailAdaptador,
    RegistroAdaptadores,
    CanalesService,
    IngestaService,
    InboxService,
    PlantillasChatService,
    BotService,
    EmprendimientosService,
    PlanesPagoService,
    ImportarUnidadesService,
    { provide: APP_GUARD, useClass: AuthGuard },
    // Después del AuthGuard a propósito: necesita el actor que aquél deja en
    // el request para saber de qué inmobiliaria es el plan.
    { provide: APP_GUARD, useClass: ModuloGuard },
    // DESPUÉS del de autenticación, y el orden es la feature: así el contador
    // general puede contar por usuario en vez de por IP, porque `req.actor` ya
    // está resuelto cuando llega acá.
    { provide: APP_GUARD, useClass: LimiteIntentosGuard },
  ],
  exports: [TokensService],
})
export class AppModule {}
