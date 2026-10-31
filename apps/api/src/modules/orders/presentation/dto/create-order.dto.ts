import { Transform, Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";

const trimmedString = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;
const lowercaseEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class OrderItemDto {
  @ApiProperty({ example: "MG-DEMO-001", maxLength: 64 })
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  sku!: string;

  @ApiProperty({ type: "integer", minimum: 1, maximum: 99, example: 1 })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;
}

export class GuestCustomerDto {
  @ApiProperty({ example: "Ana", maxLength: 100 })
  @Transform(trimmedString)
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @ApiProperty({ example: "Pérez", maxLength: 100 })
  @Transform(trimmedString)
  @IsString()
  @Length(1, 100)
  lastName!: string;

  @ApiProperty({ example: "ana@example.com", maxLength: 254 })
  @Transform(lowercaseEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: "+593991234567",
    description: "7 a 15 dígitos, con prefijo + opcional.",
  })
  @Transform(trimmedString)
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/)
  phone!: string;
}

export class ShippingAddressDto {
  @ApiProperty({ example: "Pichincha", maxLength: 100 })
  @Transform(trimmedString)
  @IsString()
  @Length(1, 100)
  province!: string;

  @ApiProperty({ example: "Quito", maxLength: 100 })
  @Transform(trimmedString)
  @IsString()
  @Length(1, 100)
  city!: string;

  @ApiProperty({
    example: "quito-norte",
    maxLength: 100,
    description: "Debe coincidir con una zona que tenga tarifa vigente.",
  })
  @Transform(trimmedString)
  @IsString()
  @Length(1, 100)
  zone!: string;

  @ApiProperty({ example: "Av. Amazonas N24-03", maxLength: 300 })
  @Transform(trimmedString)
  @IsString()
  @Length(1, 300)
  address!: string;

  @ApiProperty({ example: "Edificio azul, piso 3", maxLength: 300 })
  @Transform(trimmedString)
  @IsString()
  @Length(1, 300)
  reference!: string;
}

export class FulfillmentDto {
  @ApiProperty({ enum: ["pickup", "courier"], example: "pickup" })
  @IsIn(["pickup", "courier"])
  type!: "pickup" | "courier";

  @ApiPropertyOptional({
    type: ShippingAddressDto,
    description: "Obligatoria para courier; no se admite para pickup.",
  })
  @ValidateIf((dto: FulfillmentDto) => dto.type === "courier")
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress?: ShippingAddressDto;
}

export class BillingDto {
  @ApiProperty({ enum: ["cedula", "ruc", "passport"], example: "cedula" })
  @IsIn(["cedula", "ruc", "passport"])
  identificationType!: "cedula" | "ruc" | "passport";

  @ApiProperty({
    example: "1710034065",
    description:
      "Cédula: 10 dígitos. RUC: 13 dígitos. Pasaporte: 5 a 20 letras o dígitos.",
  })
  @Transform(trimmedString)
  @IsString()
  @Length(1, 20)
  identification!: string;

  @ApiProperty({ example: "Ana Pérez", maxLength: 200 })
  @Transform(trimmedString)
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ example: "ana@example.com", maxLength: 254 })
  @Transform(lowercaseEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: "Av. Amazonas N24-03, Quito", maxLength: 300 })
  @Transform(trimmedString)
  @IsString()
  @Length(1, 300)
  address!: string;
}

/** Totals, prices and statuses are intentionally absent: the server computes them. */
export class CreateOrderDto {
  @ApiProperty({ type: [OrderItemDto], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @ApiProperty({ type: GuestCustomerDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => GuestCustomerDto)
  customer!: GuestCustomerDto;

  @ApiProperty({ type: FulfillmentDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => FulfillmentDto)
  fulfillment!: FulfillmentDto;

  @ApiProperty({ type: BillingDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => BillingDto)
  billing!: BillingDto;
}
