import { Transform } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

// Reject arrays, whitespace and non-decimal representations instead of coercing them.
const decimalInteger = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
const trimmedString = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class ListProductsQueryDto {
  @ApiPropertyOptional({
    type: "integer",
    default: 1,
    minimum: 1,
    maximum: 2147483647,
    description: "Número de página.",
  })
  @Transform(decimalInteger)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  page = 1;

  @ApiPropertyOptional({
    type: "integer",
    default: 20,
    minimum: 1,
    maximum: 100,
    description: "Productos por página.",
  })
  @Transform(decimalInteger)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({
    example: "Nova",
    minLength: 1,
    maxLength: 100,
    description: "Búsqueda por nombre o SKU; se recortan espacios exteriores.",
  })
  @IsOptional()
  @Transform(trimmedString)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    example: "celulares",
    maxLength: 100,
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    description: "Slug de categoría.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  category?: string;
}
