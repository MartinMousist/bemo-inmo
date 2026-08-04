import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { opcionesDeLimite } from './auth/limite-intentos';
import { LimiteStoragePostgres } from './auth/limite-storage';
import { DatabaseModule } from './database/database.module';
import { DbService } from './database/db.service';
import { HealthController } from './health/health.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { TokensService } from './auth/tokens.service';
import { AuthGuard } from './auth/auth.guard';
import { EquipoController } from './equipo/equipo.controller';
import { EquipoService } from './equipo/equipo.service';
import { PersonasController } from './personas/personas.controller';
import { PersonasService } from './personas/personas.service';
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
import { BcraService } from './alquileres/bcra.service';
import { LiquidacionesService } from './alquileres/liquidaciones.service';
import { ComisionesController, VentasController } from './ventas/ventas.controller';
import { VentasService } from './ventas/ventas.service';
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
import { CajaController, InicioController } from './inicio/inicio.controller';
import { CajaService } from './inicio/caja.service';
import { NotasController } from './notas/notas.controller';
import { NotasService } from './notas/notas.service';
import {
  AccesosPropietarioController,
  PortalController,
} from './portal/portal.controller';
import { PortalService } from './portal/portal.service';
import { InicioService } from './inicio/inicio.service';

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
    AuditoriaController,
    NotasController,
    AccesosPropietarioController,
    PortalController,
    EquipoController,
    PersonasController,
    PropiedadesController,
    OportunidadesController,
    ReservasController,
    ContratosController,
    AjustesController,
    CuotasController,
    CobrosController,
    IndicesController,
    LiquidacionesController,
    VentasController,
    ComisionesController,
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
  ],
  providers: [
    AuthService,
    TokensService,
    InicioService,
    CajaService,
    NotasService,
    PortalService,
    EquipoService,
    PersonasService,
    PropiedadesService,
    GeocodingService,
    OportunidadesService,
    ContratosService,
    CarteraService,
    CicloService,
    AuditoriaService,
    IndicesService,
    BcraService,
    LiquidacionesService,
    VentasService,
    PublicacionesService,
    RecordatoriosService,
    ExportarService,
    PlanesService,
    ImportarService,
    FotosService,
    AlmacenamientoService,
    PlantillasService,
    // Guard GLOBAL: todo exige token salvo lo marcado con @Publico().
    // Si fuera opt-in, un endpoint nuevo sin decorador quedaría abierto.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokensService],
})
export class AppModule {}
