import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { CORRELATION_ID_HEADER } from "../middleware/correlation-id.middleware";
import type { RequestWithCorrelation } from "../types/request-with-correlation.interface";

export const CorrelationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<RequestWithCorrelation>();
    const headerValue = request.headers?.[CORRELATION_ID_HEADER];
    return (
      request.correlationId ??
      (typeof headerValue === "string" ? headerValue : "unknown")
    );
  },
);
