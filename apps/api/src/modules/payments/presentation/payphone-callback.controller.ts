import { createHash } from "node:crypto";
import {
  BadRequestException,
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Response } from "express";
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { RequestWithCorrelation } from "../../../common/types/request-with-correlation.interface";
import { HandlePayPhoneCallbackUseCase } from "../application/handle-callback.use-case";
import {
  InvalidCallbackSignatureError,
  PaymentNotFoundError,
  PaymentsDisabledError,
  ProviderSaleMismatchError,
} from "../domain/payment-errors";
import { PaymentProviderUnavailableError } from "../domain/payment-provider.port";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/;

type CallbackRequest = RequestWithCorrelation & { rawBody?: Buffer };

/** PayPhone sends "id" and "clientTransactionID" (query or body). */
function readParameter(request: CallbackRequest, ...names: string[]) {
  const sources = [request.query, request.body] as unknown[];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const name of names) {
      const value = (source as Record<string, unknown>)[name];
      if (typeof value === "string") return value.trim();
      if (typeof value === "number") return String(value);
    }
  }
  return undefined;
}

function toHttpException(error: unknown): unknown {
  if (error instanceof PaymentsDisabledError) {
    return new ServiceUnavailableException(error.message);
  }
  if (error instanceof InvalidCallbackSignatureError) {
    return new UnauthorizedException(error.message);
  }
  if (error instanceof PaymentNotFoundError) {
    return new NotFoundException(error.message);
  }
  if (error instanceof ProviderSaleMismatchError) {
    return new UnprocessableEntityException(error.message);
  }
  if (error instanceof PaymentProviderUnavailableError) {
    // Not lost: reconciliation will query PayPhone again later.
    return new ServiceUnavailableException(
      "PayPhone could not be verified now; it will be retried",
    );
  }
  return error;
}

@ApiTags("Pagos")
@Controller("payments/payphone")
export class PayPhoneCallbackController {
  constructor(private readonly handleCallback: HandlePayPhoneCallbackUseCase) {}

  @Get("callback/:signature")
  @ApiOperation({
    summary: "Aviso de PayPhone (responseUrl)",
    description:
      "Lo llama PayPhone, no la web. La firma HMAC de la ruta debe coincidir; luego se consulta el estado real a PayPhone. El aviso por sí solo nunca confirma un pago.",
  })
  @ApiParam({ name: "signature", description: "HMAC generado por la API" })
  @ApiQuery({ name: "id", description: "transactionId de PayPhone" })
  @ApiQuery({ name: "clientTransactionID" })
  @ApiResponse({ status: 200, description: "Procesado o duplicado." })
  @ApiResponse({ status: 202, description: "La venta sigue pendiente." })
  @ApiResponse({ status: 401, description: "Firma inválida." })
  @ApiResponse({ status: 422, description: "No coincide con PayPhone." })
  @ApiResponse({ status: 503, description: "PayPhone no verificable ahora." })
  receiveGet(
    @Param("signature") signature: string,
    @Req() request: CallbackRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.receive(signature, request, response);
  }

  @Post("callback/:signature")
  @ApiOperation({ summary: "Aviso de PayPhone (variante POST)" })
  receivePost(
    @Param("signature") signature: string,
    @Req() request: CallbackRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.receive(signature, request, response);
  }

  private async receive(
    signature: string,
    request: CallbackRequest,
    response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    const correlationId = request.correlationId ?? "unknown";
    if (!SIGNATURE.test(signature)) {
      throw new UnauthorizedException("Invalid callback signature");
    }
    const transactionId = readParameter(request, "id", "transactionId");
    const clientTransactionId = readParameter(
      request,
      "clientTransactionID",
      "clientTransactionId",
    );
    if (
      !transactionId ||
      !clientTransactionId ||
      !ID.test(transactionId) ||
      !ID.test(clientTransactionId)
    ) {
      throw new BadRequestException("id and clientTransactionID are required");
    }
    // Fingerprint of the original notification as received (method, URL, raw body).
    const payloadHash = createHash("sha256")
      .update(`${request.method} ${request.originalUrl}\n`)
      .update(request.rawBody ?? Buffer.alloc(0))
      .digest("hex");
    try {
      const outcome = await this.handleCallback.execute({
        signature,
        transactionId,
        clientTransactionId,
        payloadHash,
        correlationId,
      });
      if (outcome.kind === "pending") {
        response.status(HttpStatus.ACCEPTED);
        return { received: true, result: "pending", correlationId };
      }
      response.status(HttpStatus.OK);
      return { received: true, result: outcome.kind, correlationId };
    } catch (error) {
      throw toHttpException(error);
    }
  }
}
