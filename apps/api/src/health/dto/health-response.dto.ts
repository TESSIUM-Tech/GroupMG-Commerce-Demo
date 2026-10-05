import { ApiProperty } from "@nestjs/swagger";
import {
  ApiErrorDto,
  CorrelatedResponseDto,
} from "../../documentation/api-response.dto";
import { HealthValidateDto } from "./health-validate.dto";

export class HealthResponseDto extends CorrelatedResponseDto {
  @ApiProperty({ example: "api", enum: ["api"] }) service!: string;
  @ApiProperty({ example: "ok", enum: ["ok"] }) status!: string;
  @ApiProperty({ example: "liveness", enum: ["liveness"] }) scope!: string;
}

class DatabaseChecksDto {
  @ApiProperty({ example: "ok", enum: ["ok"] }) database!: string;
}

export class ReadinessResponseDto extends CorrelatedResponseDto {
  @ApiProperty({ example: "api" }) service!: string;
  @ApiProperty({ example: "ok" }) status!: string;
  @ApiProperty({ example: "readiness" }) scope!: string;
  @ApiProperty({ type: DatabaseChecksDto }) checks!: DatabaseChecksDto;
}

class FailedDatabaseChecksDto {
  @ApiProperty({ example: "down", enum: ["down"] }) database!: string;
}

export class ReadinessErrorDto extends ApiErrorDto {
  @ApiProperty({ example: "api" }) service!: string;
  @ApiProperty({ example: "readiness" }) scope!: string;
  @ApiProperty({ type: FailedDatabaseChecksDto })
  checks!: FailedDatabaseChecksDto;
}

export class ValidatedResponseDto extends CorrelatedResponseDto {
  @ApiProperty({ example: "api" }) service!: string;
  @ApiProperty({ example: "ok" }) status!: string;
  @ApiProperty({ example: true }) validated!: boolean;
  @ApiProperty({ type: HealthValidateDto }) data!: HealthValidateDto;
}
