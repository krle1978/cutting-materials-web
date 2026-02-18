const port = Number(process.env.PORT ?? 4000);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer");
}

const databaseUrl = process.env.DATABASE_URL;

const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  port,
  databaseUrl,
  corsOrigins
};
