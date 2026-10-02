import type { Request } from "express";

export interface RequestWithCorrelation extends Request {
  correlationId?: string;
}
