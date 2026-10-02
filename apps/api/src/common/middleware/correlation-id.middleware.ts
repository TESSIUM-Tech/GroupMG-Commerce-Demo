import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import type { RequestWithCorrelation } from "../types/request-with-correlation.interface";

export const CORRELATION_ID_HEADER = "x-correlation-id";
const VALID_CORRELATION_ID_REGEX = /^[a-zA-Z0-9_\-.]{1,128}$/;

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: RequestWithCorrelation, res: Response, next: NextFunction): void {
    const rawHeader =
      req.headers[CORRELATION_ID_HEADER] ?? req.headers["x-request-id"];

    let correlationId: string;
    if (
      typeof rawHeader === "string" &&
      VALID_CORRELATION_ID_REGEX.test(rawHeader.trim())
    ) {
      correlationId = rawHeader.trim();
    } else {
      correlationId = randomUUID();
    }

    req.correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  }
}
