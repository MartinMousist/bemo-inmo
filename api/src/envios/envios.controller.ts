import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID,
  Max, MaxLength, Min,
} from 'class-validator';
import {
  Body, Controller, Delete, Get, HttpCode, Param, Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EnviosService } from './envios.service';
import { ActorActual, Publico, Roles, type Actor } from '../auth/decoradores';

class CrearEnvioDto {
  @IsArray()
  @ArrayMinSize(1)
  // 30 fichas ya es demasiado para que alguien las mire. Un envío de 200 no es
  // una selección, es un volcado del catálogo, y no ayuda a vender.
  @ArrayMaxSize(30)
  @IsUUID('4', { each: true })
  propiedades!: string[];

  @IsOptional() @IsUUID('4')
  personaId?: string;

  @IsOptional() @IsString() @MaxLength(120)
  contactoNombre?: string;

  @IsOptional() @IsString() @MaxLength(120)
  titulo?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  mensaje?: string;

  @IsOptional() @IsInt() @Min(1) @Max(365)
  diasValidez?: number;
}

@Controller('envios')
export class EnviosController {
  constructor(private readonly envios: EnviosService) {}

  /** Cualquier asesor puede mandarle propiedades a su cliente: es su trabajo. */
  @Post()
  @Roles('owner', 'admin', 'agente')
  crear(@ActorActual() a: Actor, @Body() d: CrearEnvioDto) {
    return this.envios.crear(a.tenantId, a.usuarioId, d);
  }

  @Get()
  @Roles('owner', 'admin', 'agente')
  listar(@ActorActual() a: Actor) {
    return this.envios.listar(a.tenantId);
  }

  @Delete(':id')
  @Roles('owner', 'admin', 'agente')
  @HttpCode(204)
  eliminar(@ActorActual() a: Actor, @Param('id') id: string) {
    return this.envios.eliminar(a.tenantId, id);
  }
}

/**
 * Lo que abre el cliente. Sin sesión y sin cuenta.
 *
 * Va con límite por IP: es una ruta pública que consulta la base, y el token es
 * lo único que la protege. Sin límite, alguien puede probar enlaces al azar
 * todo el día. Con 176 bits no los va a adivinar, pero tampoco tiene por qué
 * poder intentarlo gratis.
 */
@Controller('seleccion')
export class SeleccionPublicaController {
  constructor(private readonly envios: EnviosService) {}

  @Get(':token')
  @Publico()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  abrir(@Param('token') token: string) {
    return this.envios.abrir(token);
  }
}
