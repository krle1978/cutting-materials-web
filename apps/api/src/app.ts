import cors from "@fastify/cors";
import Fastify from "fastify";
import { registerInventoryRoutes } from "./routes/inventory";
import { registerOrdersRoutes } from "./routes/orders";
import type { PlanStore } from "./db/types";

type BuildAppOptions = {
  corsOrigins: string[];
  store: PlanStore;
};

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (options.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("CORS origin denied"), false);
    }
  });

  app.get("/health", async () => ({ ok: true }));
  await registerInventoryRoutes(app, { store: options.store });
  await registerOrdersRoutes(app, { store: options.store });

  return app;
}

