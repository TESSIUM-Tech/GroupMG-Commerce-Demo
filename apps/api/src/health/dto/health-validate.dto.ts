import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class HealthValidateDto {
  @ApiProperty({ example: "Hola GroupMG", minLength: 1, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  echo!: string;

  @ApiPropertyOptional({
    type: "integer",
    example: 2,
    minimum: 1,
    maximum: 100,
    description: "Valor de prueba; se devuelve sin ejecutar repeticiones.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  repeat?: number;
}
