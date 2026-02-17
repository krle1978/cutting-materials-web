export const migrationStatements = [
  `
    CREATE TABLE IF NOT EXISTS inventory (
      id SERIAL PRIMARY KEY,
      length_mm INTEGER NOT NULL UNIQUE CHECK (length_mm > 0),
      qty INTEGER NOT NULL CHECK (qty >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS plans (
      id UUID PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('PLANNED', 'COMMITTED', 'EXPIRED')),
      params_json JSONB NOT NULL,
      order_json JSONB NOT NULL,
      result_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      committed_at TIMESTAMPTZ NULL
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS inventory_length_mm_idx
    ON inventory (length_mm);
  `
];

