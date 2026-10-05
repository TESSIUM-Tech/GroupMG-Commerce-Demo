import { ApiProperty } from "@nestjs/swagger";

export class CorrelatedResponseDto {
  @ApiProperty({ example: "demo-request-1" })
  correlationId!: string;
}

export class ApiErrorDto extends CorrelatedResponseDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;
  @ApiProperty({ example: "Bad Request" })
  error!: string;
  @ApiProperty({
    oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
    example: ["page must not be less than 1"],
  })
  message!: string | string[];
  @ApiProperty({ format: "date-time" })
  timestamp!: string;
  @ApiProperty({ example: "/api/v1/products?page=0" })
  path!: string;
}
