import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
} from "@nestjs/common";
import { CorrelationId } from "../../../common/decorators/correlation-id.decorator";
import { GetProductUseCase } from "../application/get-product.use-case";
import { ListProductsUseCase } from "../application/list-products.use-case";
import { ListProductsQueryDto } from "./dto/list-products-query.dto";
import {
  ApiTags,
  ApiOperation,
  ApiHeader,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiInternalServerErrorResponse,
  ApiParam,
} from "@nestjs/swagger";
import { ApiErrorDto } from "../../../documentation/api-response.dto";
import {
  ProductListResponseDto,
  ProductDetailResponseDto,
} from "./dto/product-response.dto";

@ApiTags("Catálogo")
@ApiHeader({
  name: "x-correlation-id",
  required: false,
  description:
    "Identificador de seguimiento opcional (1–128 caracteres alfanuméricos, guion, punto o guion bajo). Si falta o es inválido, se genera uno; se devuelve en el cuerpo y la cabecera.",
})
@ApiInternalServerErrorResponse({
  description: "Error interno o fallo de acceso a la base de datos.",
  type: ApiErrorDto,
})
@Controller("products")
export class ProductsController {
  constructor(
    private readonly listProducts: ListProductsUseCase,
    private readonly getProduct: GetProductUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Listar productos publicados",
    description:
      "Filtra por nombre/SKU y slug de categoría. Solo incluye productos publicados; puede incluir productos agotados. Ordena por nombre y luego por id. Una búsqueda sin coincidencias devuelve items vacío. No admite parámetros adicionales.",
  })
  @ApiOkResponse({ type: ProductListResponseDto })
  @ApiBadRequestResponse({
    description: "Parámetros inválidos o no permitidos.",
    type: ApiErrorDto,
  })
  async list(
    @Query() query: ListProductsQueryDto,
    @CorrelationId() correlationId: string,
  ) {
    return { ...(await this.listProducts.execute(query)), correlationId };
  }

  @Get(":id")
  @ApiOperation({
    summary: "Consultar una ficha por UUID",
    description: "Usa el id devuelto por el listado, no el SKU.",
  })
  @ApiParam({
    name: "id",
    format: "uuid",
    example: "11111111-1111-4111-8111-111111111111",
  })
  @ApiOkResponse({ type: ProductDetailResponseDto })
  @ApiBadRequestResponse({
    description: "El identificador no es un UUID válido.",
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: "Producto inexistente o no visible en el catálogo.",
    type: ApiErrorDto,
  })
  async detail(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CorrelationId() correlationId: string,
  ) {
    const product = await this.getProduct.execute(id);
    if (!product) throw new NotFoundException("Product not found");
    return { product, correlationId };
  }
}
