import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Response } from "express";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import { CorrelationId } from "../../../common/decorators/correlation-id.decorator";
import { ApiErrorDto } from "../../../documentation/api-response.dto";
import { CreateOrderUseCase } from "../application/create-order.use-case";
import { GetOrderUseCase } from "../application/get-order.use-case";
import { CreateOrderDto } from "./dto/create-order.dto";
import {
  CreateOrderResponseDto,
  OrderDetailResponseDto,
} from "./dto/order-response.dto";
import {
  parseBearerToken,
  parseIdempotencyKey,
  toCreateOrderCommand,
  toHttpException,
} from "./order-http.mapper";

@ApiTags("Pedidos")
@ApiHeader({
  name: "x-correlation-id",
  required: false,
  description: "Identificador de seguimiento opcional.",
})
@ApiInternalServerErrorResponse({
  description: "Error interno o fallo de acceso a la base de datos.",
  type: ApiErrorDto,
})
@Controller("orders")
export class OrdersController {
  constructor(
    private readonly createOrder: CreateOrderUseCase,
    private readonly getOrder: GetOrderUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary: "Crear un pedido pendiente de pago",
    description:
      "Calcula precios, IVA y envío en el servidor y reserva stock durante 5 minutos. No admite importes del cliente. Repetir la misma Idempotency-Key con el mismo cuerpo devuelve el mismo pedido (200) con un token nuevo; con otro cuerpo responde 422.",
  })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "16 a 128 caracteres A-Z, a-z, 0-9, _ o -. Un UUID sirve.",
  })
  @ApiCreatedResponse({ type: CreateOrderResponseDto })
  @ApiOkResponse({
    description: "Repetición idempotente: mismo pedido y token nuevo.",
    type: CreateOrderResponseDto,
  })
  @ApiBadRequestResponse({
    description: "Cuerpo o cabecera inválidos, o campos no permitidos.",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: "Stock insuficiente; incluye los SKU afectados.",
    type: ApiErrorDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      "Producto no disponible, zona sin tarifa vigente o Idempotency-Key reutilizada con otro cuerpo.",
    type: ApiErrorDto,
  })
  async create(
    @Headers("idempotency-key") idempotencyKeyHeader: unknown,
    @Body() dto: CreateOrderDto,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const idempotencyKey = parseIdempotencyKey(idempotencyKeyHeader);
    const command = toCreateOrderCommand(dto);
    try {
      const result = await this.createOrder.execute(idempotencyKey, command);
      response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
      response.setHeader("Cache-Control", "no-store");
      return {
        order: result.order,
        accessToken: result.accessToken,
        correlationId,
      };
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @Get(":id")
  @ApiOperation({
    summary: "Consultar un pedido invitado",
    description:
      "Requiere el token entregado al crear el pedido. Un token incorrecto o vencido responde igual que un pedido inexistente.",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiHeader({
    name: "Authorization",
    required: true,
    description: "Bearer <accessToken>",
  })
  @ApiOkResponse({ type: OrderDetailResponseDto })
  @ApiBadRequestResponse({ description: "UUID inválido.", type: ApiErrorDto })
  @ApiUnauthorizedResponse({
    description: "Falta el token o su formato es inválido.",
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: "Pedido inexistente, token incorrecto o vencido.",
    type: ApiErrorDto,
  })
  async detail(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("authorization") authorization: unknown,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = parseBearerToken(authorization);
    if (!token) {
      throw new UnauthorizedException("A valid order access token is required");
    }
    const order = await this.getOrder.execute(id, token);
    if (!order) throw new NotFoundException("Order not found");
    response.setHeader("Cache-Control", "no-store");
    return { order, correlationId };
  }
}
