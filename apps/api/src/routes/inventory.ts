import { inventoryAddRequestSchema } from "@cutting/contracts";
import type { FastifyInstance } from "fastify";
import type { PlanStore } from "../db/types";

type InventoryRoutesOptions = {
  store: PlanStore;
};

export async function registerInventoryRoutes(
  app: FastifyInstance,
  options: InventoryRoutesOptions
): Promise<void> {
  app.get("/inventory", async () => {
    const items = await options.store.listInventory();
    return { items };
  });

  app.post("/inventory/add", async (request, reply) => {
    const parsed = inventoryAddRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        ok: false,
        error: "Invalid request body",
        details: parsed.error.issues
      };
    }

    await options.store.addInventory(parsed.data.lengthMm, parsed.data.qty, parsed.data.inventoryClass);
    return { ok: true };
  });
}
