import { ApiProperty } from "@nestjs/swagger";
import { CorrelatedResponseDto } from "../../../../documentation/api-response.dto";

class CategoryDto {
  @ApiProperty({ example: "celulares" }) slug!: string;
  @ApiProperty({ example: "Celulares" }) name!: string;
}

export class ProductResponseDto {
  @ApiProperty({
    format: "uuid",
    example: "11111111-1111-4111-8111-111111111111",
  })
  id!: string;
  @ApiProperty({ example: "MG-DEMO-001" }) sku!: string;
  @ApiProperty({ example: "Nova X1" }) name!: string;
  @ApiProperty({ type: CategoryDto }) category!: CategoryDto;
  @ApiProperty({
    type: "integer",
    example: 19900,
    description:
      "Precio base en unidades monetarias menores; 19900 equivale a 199,00 USD.",
  })
  priceMinor!: number;
  @ApiProperty({ example: "USD" }) currency!: string;
  @ApiProperty({
    type: "integer",
    example: 1500,
    description: "Impuesto en puntos básicos: 1500 equivale al 15 %.",
  })
  taxRateBps!: number;
  @ApiProperty({ example: "/images/products/nova-x1.svg" }) imageUrl!: string;
  @ApiProperty({ type: "integer", minimum: 0, example: 20 })
  availableQuantity!: number;
  @ApiProperty({ example: true }) inStock!: boolean;
}

class PaginationDto {
  @ApiProperty({ type: "integer", example: 1 }) page!: number;
  @ApiProperty({ type: "integer", example: 20 }) limit!: number;
  @ApiProperty({ type: "integer", example: 7 }) total!: number;
  @ApiProperty({ type: "integer", example: 1 }) totalPages!: number;
}

export class ProductListResponseDto extends CorrelatedResponseDto {
  @ApiProperty({ type: [ProductResponseDto] }) items!: ProductResponseDto[];
  @ApiProperty({ type: PaginationDto }) pagination!: PaginationDto;
}

export class ProductDetailResponseDto extends CorrelatedResponseDto {
  @ApiProperty({ type: ProductResponseDto }) product!: ProductResponseDto;
}
