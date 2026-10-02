import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import type { RequestWithCorrelation } from "../types/request-with-correlation.interface";
import { CORRELATION_ID_HEADER } from "../middleware/correlation-id.middleware";

export interface ApiErrorResponse {
  statusCode: number;
  error: string;
  message: string | string[];
  correlationId: string;
  timestamp: string;
  path: string;
  [key: string]: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithCorrelation>();

    const correlationId =
      request.correlationId ??
      (typeof request.headers?.[CORRELATION_ID_HEADER] === "string"
        ? request.headers[CORRELATION_ID_HEADER]
        : "unknown");

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = "Internal Server Error";
    let message: string | string[] = "An internal server error occurred";
    let extraFields: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === "string") {
        message = res;
        error = exception.name.replace(/Exception$/, "");
      } else if (typeof res === "object" && res !== null) {
        const resObj = res as Record<string, unknown>;
        if (Array.isArray(resObj.message)) {
          message = resObj.message as string[];
        } else if (typeof resObj.message === "string") {
          message = resObj.message;
        } else {
          message = exception.message;
        }

        if (typeof resObj.error === "string") {
          error = resObj.error;
        } else {
          error = exception.name.replace(/Exception$/, "");
        }

        // Include domain fields from exception response (e.g., checks, service, scope)
        const { statusCode: _sc, error: _err, message: _msg, ...rest } = resObj;
        extraFields = rest;
      }
    } else {
      // Unhandled exception (e.g., database connection down or unexpected error)
      const errName =
        exception instanceof Error ? exception.constructor.name : "Error";
      const errMessage =
        exception instanceof Error ? exception.message : "Unknown error";

      // Server-side logging without leaking secrets or credentials
      console.error(
        `[API] [${correlationId}] Unhandled internal exception: ${errName} - ${errMessage} (stack omitted from response, credentials not logged)`,
      );
    }

    const errorPayload: ApiErrorResponse = {
      statusCode,
      error,
      message,
      ...extraFields,
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl ?? request.url ?? "",
    };

    // Ensure correlationId header is also set on the error response
    if (!response.headersSent) {
      response.setHeader(CORRELATION_ID_HEADER, correlationId);
    }

    response.status(statusCode).json(errorPayload);
  }
}
