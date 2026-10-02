import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { CorrelationId } from "../common/decorators/correlation-id.decorator";
import { HealthValidateDto } from "./dto/health-validate.dto";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  getHealth(@CorrelationId() correlationId: string) {
    return {
      service: "api",
      status: "ok",
      scope: "liveness",
      correlationId,
    };
  }

  @Get("liveness")
  getLiveness(@CorrelationId() correlationId: string) {
    return {
      service: "api",
      status: "ok",
      scope: "liveness",
      correlationId,
    };
  }

  @Get("readiness")
  async getReadiness(@CorrelationId() correlationId: string) {
    const isDbConnected = await this.prisma.ping();

    if (!isDbConnected) {
      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: "Service Unavailable",
        message: "Database readiness check failed",
        service: "api",
        scope: "readiness",
        checks: {
          database: "down",
        },
        correlationId,
      });
    }

    return {
      service: "api",
      status: "ok",
      scope: "readiness",
      checks: {
        database: "ok",
      },
      correlationId,
    };
  }

  @Post("validate")
  validateDto(
    @Body() dto: HealthValidateDto,
    @CorrelationId() correlationId: string,
  ) {
    return {
      service: "api",
      status: "ok",
      validated: true,
      data: dto,
      correlationId,
    };
  }
}
