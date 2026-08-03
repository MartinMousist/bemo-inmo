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

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, AuthController, EquipoController],
  providers: [
    AuthService,
    TokensService,
    EquipoService,
    // Guard GLOBAL: todo exige token salvo lo marcado con @Publico().
    // Si fuera opt-in, un endpoint nuevo sin decorador quedaría abierto.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokensService],
})
export class AppModule {}
