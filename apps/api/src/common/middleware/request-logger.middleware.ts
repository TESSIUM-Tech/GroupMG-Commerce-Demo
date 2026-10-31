import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Response, NextFunction } from "express";
import type { RequestWithCorrelation } from "../types/request-with-correlation.interface";

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  use(req: RequestWithCorrelation, res: Response, next: NextFunction): void {
    const start = Date.now();

    res.on("finish", () => {
      const duration = Date.now() - start;
      const correlationId = req.correlationId ?? "unknown";
      // Log structured line without credentials, tokens, or personal payloads
      console.log(
        `[API] [${correlationId}] ${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`,
      );
    });

    next();
  }
}
