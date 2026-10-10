import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { CorrelatedResponseDto } from "../../../../documentation/api-response.dto";

const trimmedString = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/** Amounts are absent on purpose: the server charges the persisted total. */
export class StartPaymentDto {
  @ApiPropertyOptional({
    example: "0991234567",
    description:
      "Celular con cuenta PayPhone. Si se omite, se usa el teléfono del pedido.",
  })
  @IsOptional()
  @Transform(trimmedString)
  @IsString()
  @MinLength(9)
  @MaxLength(20)
  phone?: string;
}

class PaymentResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) orderId!: string;
  @ApiProperty({
    enum: ["pending", "approved", "canceled", "rejected", "review_required"],
  })
  status!: string;
  @ApiProperty({ type: "integer", example: 3450 }) amountMinor!: number;
  @ApiProperty({ example: "USD" }) currency!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}

export class StartPaymentResponseDto extends CorrelatedResponseDto {
  @ApiProperty({ type: PaymentResponseDto }) payment!: PaymentResponseDto;
  @ApiProperty({
    enum: ["approve_in_payphone_app", "awaiting_confirmation"],
    description:
      "approve_in_payphone_app: el cliente aprueba en la app PayPhone. awaiting_confirmation: PayPhone no respondió; se reconciliará.",
  })
  nextStep!: string;
  @ApiProperty({ format: "date-time" }) reservationExpiresAt!: string;
}
