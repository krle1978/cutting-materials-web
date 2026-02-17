import { buildApp } from "./app";
import { config } from "./config";
import { MemoryStore } from "./db/memory-store";
import { PostgresStore } from "./db/postgres-store";

async function start() {
  const store = config.databaseUrl ? new PostgresStore(config.databaseUrl) : new MemoryStore();
  await store.migrate();

  const app = await buildApp({
    corsOrigins: config.corsOrigins,
    store
  });

  app.addHook("onClose", async () => {
    await store.close();
  });

  await app.listen({
    host: "0.0.0.0",
    port: config.port
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

