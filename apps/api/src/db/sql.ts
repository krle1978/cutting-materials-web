export const migrationStatements = [
  `
    CREATE TABLE IF NOT EXISTS inventory (
      id SERIAL PRIMARY KEY,
      inventory_class TEXT NOT NULL DEFAULT 'Komarnici' CHECK (inventory_class IN ('Komarnici', 'Prozorske daske')),
      length_mm INTEGER NOT NULL CHECK (length_mm > 0),
      qty INTEGER NOT NULL CHECK (qty >= 0),
      UNIQUE (inventory_class, length_mm),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    ALTER TABLE inventory
    ADD COLUMN IF NOT EXISTS inventory_class TEXT;
  `,
  `
    UPDATE inventory
    SET inventory_class = 'Komarnici'
    WHERE inventory_class IS NULL;
  `,
  `
    ALTER TABLE inventory
    ALTER COLUMN inventory_class SET DEFAULT 'Komarnici';
  `,
  `
    ALTER TABLE inventory
    ALTER COLUMN inventory_class SET NOT NULL;
  `,
  `
    ALTER TABLE inventory
    DROP CONSTRAINT IF EXISTS inventory_length_mm_key;
  `,
  `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'inventory_inventory_class_check'
      ) THEN
        ALTER TABLE inventory
        ADD CONSTRAINT inventory_inventory_class_check
        CHECK (inventory_class IN ('Komarnici', 'Prozorske daske'));
      END IF;
    END $$;
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_class_length_mm_uniq
    ON inventory (inventory_class, length_mm);
  `,
  `
    INSERT INTO inventory (inventory_class, length_mm, qty)
    VALUES
      ('Komarnici', 3000, 5),
      ('Komarnici', 5000, 3),
      ('Komarnici', 7000, 6),
      ('Prozorske daske', 10000, 10),
      ('Prozorske daske', 20000, 15)
    ON CONFLICT (inventory_class, length_mm)
    DO NOTHING;
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
    CREATE INDEX IF NOT EXISTS inventory_class_length_mm_idx
    ON inventory (inventory_class, length_mm);
  `,
  `
    CREATE TABLE IF NOT EXISTS order_entries (
      id UUID PRIMARY KEY,
      inventory_class TEXT NOT NULL CHECK (inventory_class IN ('Komarnici', 'Prozorske daske')),
      height_mm INTEGER NULL CHECK (height_mm > 0),
      width_mm INTEGER NOT NULL CHECK (width_mm > 0),
      qty INTEGER NOT NULL CHECK (qty > 0),
      width_only BOOLEAN NOT NULL DEFAULT FALSE,
      derived_from_width BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED')),
      accepted_plan_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      accepted_at TIMESTAMPTZ NULL
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS order_entries_status_created_idx
    ON order_entries (status, created_at DESC);
  `
];
