import { ApiProperty } from "@nestjs/swagger";
import { CorrelatedResponseDto } from "../../../../documentation/api-response.dto";
import { ORDER_STATUSES } from "../../domain/order-status";

class OrderItemResponseDto {
  @ApiProperty({ example: "MG-DEMO-001" }) sku!: string;
  @ApiProperty({ example: "Celular Nova X1 128 GB" }) productName!: string;
  @ApiProperty({ type: "integer", example: 1 }) quantity!: number;
  @ApiProperty({ type: "integer", example: 19900 }) unitPriceMinor!: number;
  @ApiProperty({ type: "integer", example: 1500 }) taxRateBps!: number;
  @ApiProperty({ type: "integer", example: 2985 }) taxMinor!: number;
  @ApiProperty({ type: "integer", example: 22885 }) totalMinor!: number;
}

export class OrderResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ORDER_STATUSES, example: "pending_payment" })
  status!: string;
  @ApiProperty({ example: "USD" }) currency!: string;
  @ApiProperty({ enum: ["pickup", "courier"] }) fulfillment!: string;
  @ApiProperty({ type: [OrderItemResponseDto] })
  items!: OrderItemResponseDto[];
  @ApiProperty({ type: "integer", example: 19900 }) subtotalMinor!: number;
  @ApiProperty({ type: "integer", example: 2985 }) taxMinor!: number;
  @ApiProperty({ type: "integer", example: 0 }) shippingMinor!: number;
  @ApiProperty({ type: "integer", example: 0 }) shippingTaxMinor!: number;
  @ApiProperty({
    type: "integer",
    example: 22885,
    description: "Calculado por el servidor en centavos USD.",
  })
  totalMinor!: number;
  @ApiProperty({ format: "date-time" }) reservationExpiresAt!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}

export class CreateOrderResponseDto extends CorrelatedResponseDto {
  @ApiProperty({ type: OrderResponseDto }) order!: OrderResponseDto;
  @ApiProperty({
    description:
      "Credencial opaca para consultar el pedido. Solo se muestra en esta respuesta; enviarla como Authorization: Bearer.",
  })
  accessToken!: string;
}

export class OrderDetailResponseDto extends CorrelatedResponseDto {
  @ApiProperty({ type: OrderResponseDto }) order!: OrderResponseDto;
}
