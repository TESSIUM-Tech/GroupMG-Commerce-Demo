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
import {
  ApiTags,
  ApiOperation,
  ApiHeader,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiServiceUnavailableResponse,
  ApiInternalServerErrorResponse,
} from "@nestjs/swagger";
import { ApiErrorDto } from "../documentation/api-response.dto";
import {
  HealthResponseDto,
  ReadinessResponseDto,
  ReadinessErrorDto,
  ValidatedResponseDto,
} from "./dto/health-response.dto";

@ApiTags("Salud")
@ApiHeader({
  name: "x-correlation-id",
  required: false,
  description:
    "Identificador opcional de seguimiento. Se genera si falta o es inválido y se devuelve en cuerpo y cabecera.",
})
@ApiInternalServerErrorResponse({
  type: ApiErrorDto,
  description: "Error interno inesperado.",
})
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: "Comprobar que la API responde",
    description: "Equivale a liveness; no comprueba PostgreSQL.",
  })
  @ApiOkResponse({ type: HealthResponseDto })
  getHealth(@CorrelationId() correlationId: string) {
    return {
      service: "api",
      status: "ok",
      scope: "liveness",
      correlationId,
    };
  }

  @Get("liveness")
  @ApiOperation({
    summary: "Comprobar liveness",
    description: "Comprueba que el proceso HTTP responde.",
  })
  @ApiOkResponse({ type: HealthResponseDto })
  getLiveness(@CorrelationId() correlationId: string) {
    return {
      service: "api",
      status: "ok",
      scope: "liveness",
      correlationId,
    };
  }

  @Get("readiness")
  @ApiOperation({ summary: "Comprobar conexión a PostgreSQL" })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({
    description: "PostgreSQL no está disponible; checks.database es down.",
    type: ReadinessErrorDto,
  })
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
  @ApiOperation({
    summary: "Probar validación de un cuerpo JSON",
    description:
      "Devuelve los datos validados; no persiste datos. Rechaza propiedades adicionales.",
  })
  @ApiCreatedResponse({ type: ValidatedResponseDto })
  @ApiBadRequestResponse({
    description: "Campos inválidos, ausentes o no permitidos.",
    type: ApiErrorDto,
  })
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
