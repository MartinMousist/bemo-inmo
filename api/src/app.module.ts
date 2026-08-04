import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
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
  IndicesController,
  LiquidacionesController,
} from './alquileres/alquileres.controller';
import { ContratosService } from './alquileres/contratos.service';
import { IndicesService } from './alquileres/indices.service';
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

@Module({
  imports: [DatabaseModule],
  controllers: [
    HealthController,
    AuthController,
    EquipoController,
    PersonasController,
    PropiedadesController,
    OportunidadesController,
    ReservasController,
    ContratosController,
    AjustesController,
    CobrosController,
    IndicesController,
    LiquidacionesController,
    VentasController,
    ComisionesController,
    PublicacionesController,
    FeedController,
    RecordatoriosController,
  ],
  providers: [
    AuthService,
    TokensService,
    EquipoService,
    PersonasService,
    PropiedadesService,
    GeocodingService,
    OportunidadesService,
    ContratosService,
    IndicesService,
    LiquidacionesService,
    VentasService,
    PublicacionesService,
    RecordatoriosService,
    // Guard GLOBAL: todo exige token salvo lo marcado con @Publico().
    // Si fuera opt-in, un endpoint nuevo sin decorador quedaría abierto.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokensService],
})
export class AppModule {}
