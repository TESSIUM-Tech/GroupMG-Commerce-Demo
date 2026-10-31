const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  availableQuantity,
} = require("../dist/modules/catalog/domain/product-availability");
const {
  ListProductsUseCase,
} = require("../dist/modules/catalog/application/list-products.use-case");
const {
  GetProductUseCase,
} = require("../dist/modules/catalog/application/get-product.use-case");

test("availability subtracts reservations and never returns negative stock", () => {
  assert.equal(availableQuantity(10, 3), 7);
  assert.equal(availableQuantity(5, 5), 0);
  assert.equal(availableQuantity(0, 0), 0);
  assert.equal(availableQuantity(2, 3), 0);
});

test("listing delegates filters and computes pagination including empty collections", async () => {
  const query = { page: 2, limit: 2, q: "phone", category: "audio" };
  const useCase = new ListProductsUseCase({
    listPublished: async (received) => {
      assert.deepEqual(received, query);
      return { items: [{ id: "product" }], total: 3 };
    },
  });
  assert.deepEqual(await useCase.execute(query), {
    items: [{ id: "product" }],
    pagination: { page: 2, limit: 2, total: 3, totalPages: 2 },
  });
  const empty = new ListProductsUseCase({
    listPublished: async () => ({ items: [], total: 0 }),
  });
  assert.equal(
    (await empty.execute({ page: 1, limit: 20 })).pagination.totalPages,
    0,
  );
});

test("detail preserves missing results without coupling application to HTTP", async () => {
  const useCase = new GetProductUseCase({
    findPublishedById: async (id) => {
      assert.equal(id, "missing");
      return null;
    },
  });
  assert.equal(await useCase.execute("missing"), null);
});
