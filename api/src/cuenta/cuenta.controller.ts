import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { IsBoolean, IsIn } from 'class-validator';
import { CuentaService } from './cuenta.service';
import { TIPOS, type TipoCuenta } from './modulos.motor';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

class CambiarTipoDto {
  @IsIn(TIPOS as unknown as string[]) tipo!: TipoCuenta;
}

class CambiarModuloDto {
  @IsBoolean() activo!: boolean;
}

/**
 * El tipo de cuenta y sus módulos.
 *
 * Lo LEE cualquiera del equipo: el front arma el menú con esto, y un asesor que
 * no pudiera leerlo vería una barra lateral vacía. Lo ESCRIBE sólo el titular —
 * apagar Ventas para toda la inmobiliaria no es una preferencia personal, le
 * cambia la aplicación a todos.
 */
@Controller('cuenta')
export class CuentaController {
  constructor(private readonly cuenta: CuentaService) {}

  @Get()
  leer(@ActorActual() a: Actor) {
    return this.cuenta.leer(a.tenantId);
  }

  @Put('tipo')
  @Roles('owner')
  cambiarTipo(@ActorActual() a: Actor, @Body() dto: CambiarTipoDto) {
    return this.cuenta.cambiarTipo(a.tenantId, dto.tipo);
  }

  @Put('modulos/:clave')
  @Roles('owner')
  cambiarModulo(
    @ActorActual() a: Actor,
    @Param('clave') clave: string,
    @Body() dto: CambiarModuloDto,
  ) {
    return this.cuenta.cambiarModulo(a.tenantId, clave, dto.activo);
  }
}
