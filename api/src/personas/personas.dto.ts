import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

const DOC_TIPOS = ['dni', 'cuit', 'cuil', 'pasaporte', 'le', 'lc'] as const;

export class CrearPersonaDto {
  @IsOptional()
  @IsIn(['fisica', 'juridica'])
  tipo?: 'fisica' | 'juridica';

  @IsString()
  @Length(2, 120)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  apellido?: string;

  @IsOptional()
  @IsIn(DOC_TIPOS as unknown as string[])
  docTipo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  docNumero?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo no tiene un formato válido' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  domicilio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notas?: string;
}

export class EditarPersonaDto extends CrearPersonaDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  declare nombre: string;
}
