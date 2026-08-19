import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { NotasService } from './notas.service';
import { CrearNotaDto, FiltroNotasDto } from './notas.dto';
import { ActorActual, Roles, type Actor } from '../auth/decoradores';

/**
 * Notas de seguimiento.
 *
 * Todos los roles pueden anotar: un asesor tiene que poder registrar lo que
 * habló con un inquilino, que es justamente el caso de uso. Lo único
 * restringido es borrar: una nota es el registro de algo que pasó.
 *
 * El `@Roles` con los cuatro está escrito aunque no filtre nada. Es la
 * diferencia entre «se decidió que lo haga cualquiera» y «se olvidaron», que
 * mirando el código sin él no se distingue —y es lo que verifica
 * `test/superficie.spec.ts`—.
 */
@Controller('notas')
export class NotasController {
  constructor(private readonly notas: NotasService) {}

  @Get()
  listar(@ActorActual() a: Actor, @Query() f: FiltroNotasDto) {
    return this.notas.listar(a.tenantId, f);
  }

  // Todos los roles: una nota es cómo alguien deja dicho algo, y el contable
  // que ve un gasto raro tiene que poder anotarlo igual que el asesor.
  @Post()
  @Roles('owner', 'admin', 'agente', 'contable')
  crear(@ActorActual() a: Actor, @Body() dto: CrearNotaDto) {
    return this.notas.crear(a.tenantId, dto, a.usuarioId);
  }

  @Post(':id/resolver')
  @Roles('owner', 'admin', 'agente', 'contable')
  resolver(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.notas.resolver(a.tenantId, id);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  borrar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.notas.borrar(a.tenantId, id);
  }
}
