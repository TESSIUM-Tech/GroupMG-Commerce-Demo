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
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  echo!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  repeat?: number;
}
