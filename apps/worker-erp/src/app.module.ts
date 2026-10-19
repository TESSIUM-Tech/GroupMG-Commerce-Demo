import { Module } from "@nestjs/common";
import { ERP_PORT } from "./ports/erp.port";
import { SimulatedErpAdapter } from "./adapters/simulated-erp/simulated-erp.adapter";

@Module({
  providers: [
    {
      provide: ERP_PORT,
      useFactory: () => {
        const adapter = process.env.ERP_ADAPTER ?? "simulated";
        if (adapter !== "simulated") throw new Error("Unsupported ERP_ADAPTER");
        return new SimulatedErpAdapter({
          baseUrl: process.env.ERP_BASE_URL ?? "http://127.0.0.1:3003",
          timeoutMs: Number(process.env.ERP_TIMEOUT_MS ?? 3000),
          pageSize: Number(process.env.ERP_PAGE_SIZE ?? 20),
        });
      },
    },
  ],
  exports: [ERP_PORT],
})
export class AppModule {}
