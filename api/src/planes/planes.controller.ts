import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PlanesService } from './planes.service';
import { ActorActual, Publico, Roles, type Actor } from '../auth/decoradores';

class CrearSucursalDto {
  @IsString() @MaxLength(120) nombre!: string;
  @IsOptional() @IsString() @MaxLength(200) direccion?: string;
}

class CrearClaveDto {
  @IsString() @MaxLength(80) nombre!: string;
}

@Controller('planes')
export class PlanesController {
  constructor(private readonly planes: PlanesService) {}

  /** El catálogo es público: lo consume la portada. Sin precios inventados. */
  @Publico()
  @Get()
  catalogo() {
    return this.planes.catalogo();
  }

  /** Plan vigente, límites usados y estado real del cobro. */
  @Get('mi-plan')
  estado(@ActorActual() a: Actor) {
    return this.planes.estado(a.tenantId);
  }
}

@Controller('sucursales')
export class SucursalesController {
  constructor(private readonly planes: PlanesService) {}

  @Get()
  listar(@ActorActual() a: Actor) {
    return this.planes.listarSucursales(a.tenantId);
  }

  @Post()
  @Roles('owner')
  crear(@ActorActual() a: Actor, @Body() dto: CrearSucursalDto) {
    return this.planes.crearSucursal(a.tenantId, dto);
  }
}

@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly planes: PlanesService) {}

  @Get()
  @Roles('owner')
  listar(@ActorActual() a: Actor) {
    return this.planes.listarClaves(a.tenantId);
  }

  @Post()
  @Roles('owner')
  crear(@ActorActual() a: Actor, @Body() dto: CrearClaveDto) {
    return this.planes.crearClave(a.tenantId, dto.nombre, a.usuarioId);
  }

  @Delete(':id')
  @Roles('owner')
  revocar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.planes.revocarClave(a.tenantId, id);
  }
}
