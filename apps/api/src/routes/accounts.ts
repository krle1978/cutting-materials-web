import { createAccountRequestSchema } from "@cutting/contracts";
import type { FastifyInstance } from "fastify";
import type { PlanStore } from "../db/types";
import { ConflictError } from "../utils/errors";

type AccountsRoutesOptions = {
  store: PlanStore;
};

export async function registerAccountsRoutes(
  app: FastifyInstance,
  options: AccountsRoutesOptions
): Promise<void> {
  app.get("/accounts", async () => {
    const items = await options.store.listAccounts();
    return { items };
  });

  app.post("/accounts", async (request, reply) => {
    const parsed = createAccountRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        ok: false,
        error: "Invalid request body",
        details: parsed.error.issues
      };
    }

    try {
      const account = await options.store.createAccount(parsed.data);
      const items = await options.store.listAccounts();
      return {
        ok: true,
        account,
        items
      };
    } catch (error) {
      if (error instanceof ConflictError) {
        reply.code(409);
        return { ok: false, error: error.message };
      }
      throw error;
    }
  });
}
