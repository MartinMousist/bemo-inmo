import { IsEmail, IsIn, IsOptional, IsString, Length, MinLength } from 'class-validator';

// El ValidationPipe global corre con forbidNonWhitelisted: cualquier campo que
// no esté acá hace fallar el request con 400. Un cliente que manda `rol: "owner"`
// en el signup se entera, y nosotros también.

export class RegistrarDto {
  @IsString()
  @Length(2, 120)
  inmobiliaria!: string;

  /**
   * Qué clase de cuenta es. Opcional y con default `inmobiliaria`: las cuentas
   * que ya existían se crearon sin esto y un signup viejo tiene que seguir
   * funcionando igual.
   */
  @IsOptional()
  @IsIn(['inmobiliaria', 'gestor'])
  tipo?: string;

  @IsOptional()
  @IsString()
  @Length(2, 60)
  provincia?: string;

  @IsEmail({}, { message: 'El correo no tiene un formato válido' })
  email!: string;

  @IsString()
  @MinLength(10, { message: 'La contraseña tiene que tener al menos 10 caracteres' })
  password!: string;

  @IsString()
  @Length(2, 120)
  nombre!: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'El correo no tiene un formato válido' })
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Ingresá tu contraseña' })
  password!: string;
}

export class InvitarDto {
  @IsEmail({}, { message: 'El correo no tiene un formato válido' })
  email!: string;

  @IsIn(['owner', 'admin', 'agente', 'contable'], { message: 'Rol inválido' })
  rol!: 'owner' | 'admin' | 'agente' | 'contable';
}

export class AceptarInvitacionDto {
  @IsString()
  @MinLength(10)
  token!: string;

  @IsString()
  @MinLength(10, { message: 'La contraseña tiene que tener al menos 10 caracteres' })
  password!: string;

  @IsString()
  @Length(2, 120)
  nombre!: string;
}
