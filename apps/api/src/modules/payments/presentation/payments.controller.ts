import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Response } from "express";
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import { CorrelationId } from "../../../common/decorators/correlation-id.decorator";
import { ApiErrorDto } from "../../../documentation/api-response.dto";
import { parseBearerToken } from "../../orders/presentation/order-http.mapper";
import { StartPaymentUseCase } from "../application/start-payment.use-case";
import {
  InvalidPayPhoneNumberError,
  OrderNotPayableError,
  PayableOrderNotFoundError,
  PaymentRefusedByProviderError,
  PaymentsDisabledError,
  ReservationExpiredError,
} from "../domain/payment-errors";
import { InconsistentOrderAmountError } from "../domain/sale-amounts";
import {
  StartPaymentDto,
  StartPaymentResponseDto,
} from "./dto/start-payment.dto";

function toHttpException(error: unknown): unknown {
  if (error instanceof PaymentsDisabledError) {
    return new ServiceUnavailableException(error.message);
  }
  if (error instanceof PayableOrderNotFoundError) {
    return new NotFoundException("Order not found");
  }
  if (error instanceof OrderNotPayableError) {
    return new ConflictException({
      error: "Conflict",
      message: error.message,
      orderStatus: error.status,
    });
  }
  if (error instanceof ReservationExpiredError) {
    return new ConflictException(error.message);
  }
  if (
    error instanceof InvalidPayPhoneNumberError ||
    error instanceof PaymentRefusedByProviderError
  ) {
    return new UnprocessableEntityException(error.message);
  }
  if (error instanceof InconsistentOrderAmountError) {
    // Server-side data problem, not the guest's fault; nothing was charged.
    return new BadGatewayException(error.message);
  }
  return error;
}

@ApiTags("Pagos")
@ApiHeader({
  name: "x-correlation-id",
  required: false,
  description: "Identificador de seguimiento opcional.",
})
@Controller("orders")
export class PaymentsController {
  constructor(private readonly startPayment: StartPaymentUseCase) {}

  @Post(":id/payments")
  @ApiOperation({
    summary: "Iniciar el pago PayPhone de un pedido pendiente",
    description:
      "Cobra el total calculado por el servidor al celular indicado (o al del pedido). El cliente aprueba en la app PayPhone. Si ya hay un pago pendiente se devuelve el mismo (200). Amplía la reserva para cubrir la ventana de pago de PayPhone.",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiHeader({
    name: "Authorization",
    required: true,
    description: "Bearer <accessToken> del pedido",
  })
  @ApiCreatedResponse({ type: StartPaymentResponseDto })
  @ApiOkResponse({
    description: "Ya existía un pago pendiente; no se crea otro.",
    type: StartPaymentResponseDto,
  })
  @ApiAcceptedResponse({
    description: "PayPhone no respondió; el pago queda pendiente de verificar.",
    type: StartPaymentResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: "Falta el token.",
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: "Pedido inexistente o token incorrecto.",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: "El pedido no está pendiente o su reserva venció.",
    type: ApiErrorDto,
  })
  @ApiUnprocessableEntityResponse({
    description: "Celular inválido o PayPhone rechazó la solicitud.",
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: "Pagos no configurados en este servidor.",
    type: ApiErrorDto,
  })
  async start(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("authorization") authorization: unknown,
    @Body() dto: StartPaymentDto,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = parseBearerToken(authorization);
    if (!token) {
      throw new UnauthorizedException("A valid order access token is required");
    }
    try {
      const result = await this.startPayment.execute(id, token, dto.phone);
      response.status(
        result.outcome === "created"
          ? HttpStatus.CREATED
          : result.outcome === "existing"
            ? HttpStatus.OK
            : HttpStatus.ACCEPTED,
      );
      response.setHeader("Cache-Control", "no-store");
      return {
        payment: result.payment,
        nextStep:
          result.outcome === "unconfirmed"
            ? "awaiting_confirmation"
            : "approve_in_payphone_app",
        reservationExpiresAt: result.reservationExpiresAt,
        correlationId,
      };
    } catch (error) {
      throw toHttpException(error);
    }
  }
}
