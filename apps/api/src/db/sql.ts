export const migrationStatements = [
  `
    CREATE TABLE IF NOT EXISTS accounts (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('Owner', 'Lager', 'Worker', 'Customer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_uniq
    ON accounts ((LOWER(TRIM(username))));
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_uniq
    ON accounts ((LOWER(TRIM(email))));
  `,
  `
    INSERT INTO accounts (id, username, email, password, role, created_at)
    VALUES
      ('00000000-0000-0000-0000-000000000001', 'owner', 'owner@cutting.local', 'owner123', 'Owner', '2026-02-23T00:00:00.000Z'),
      ('00000000-0000-0000-0000-000000000002', 'lager', 'lager@cutting.local', 'lager123', 'Lager', '2026-02-23T00:00:00.000Z'),
      ('00000000-0000-0000-0000-000000000003', 'worker', 'worker@cutting.local', 'worker123', 'Worker', '2026-02-23T00:00:00.000Z')
    ON CONFLICT DO NOTHING;
  `,
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
      created_by_username TEXT NOT NULL DEFAULT 'unknown',
      created_by_email TEXT NOT NULL DEFAULT 'unknown@local.invalid',
      created_by_role TEXT NOT NULL DEFAULT 'Worker' CHECK (created_by_role IN ('Owner', 'Lager', 'Worker', 'Customer')),
      needs_worker BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED')),
      accepted_plan_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      accepted_at TIMESTAMPTZ NULL
    );
  `,
  `
    ALTER TABLE order_entries
    ADD COLUMN IF NOT EXISTS created_by_username TEXT;
  `,
  `
    ALTER TABLE order_entries
    ADD COLUMN IF NOT EXISTS created_by_email TEXT;
  `,
  `
    ALTER TABLE order_entries
    ADD COLUMN IF NOT EXISTS created_by_role TEXT;
  `,
  `
    ALTER TABLE order_entries
    ADD COLUMN IF NOT EXISTS needs_worker BOOLEAN;
  `,
  `
    UPDATE order_entries
    SET created_by_username = 'unknown'
    WHERE created_by_username IS NULL OR LENGTH(TRIM(created_by_username)) = 0;
  `,
  `
    UPDATE order_entries
    SET created_by_email = 'unknown@local.invalid'
    WHERE created_by_email IS NULL OR LENGTH(TRIM(created_by_email)) = 0;
  `,
  `
    UPDATE order_entries
    SET created_by_role = 'Worker'
    WHERE created_by_role IS NULL OR LENGTH(TRIM(created_by_role)) = 0;
  `,
  `
    UPDATE order_entries
    SET needs_worker = FALSE
    WHERE needs_worker IS NULL;
  `,
  `
    ALTER TABLE order_entries
    ALTER COLUMN created_by_username SET DEFAULT 'unknown';
  `,
  `
    ALTER TABLE order_entries
    ALTER COLUMN created_by_username SET NOT NULL;
  `,
  `
    ALTER TABLE order_entries
    ALTER COLUMN created_by_email SET DEFAULT 'unknown@local.invalid';
  `,
  `
    ALTER TABLE order_entries
    ALTER COLUMN created_by_email SET NOT NULL;
  `,
  `
    ALTER TABLE order_entries
    ALTER COLUMN created_by_role SET DEFAULT 'Worker';
  `,
  `
    ALTER TABLE order_entries
    ALTER COLUMN created_by_role SET NOT NULL;
  `,
  `
    ALTER TABLE order_entries
    ALTER COLUMN needs_worker SET DEFAULT FALSE;
  `,
  `
    ALTER TABLE order_entries
    ALTER COLUMN needs_worker SET NOT NULL;
  `,
  `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'order_entries_created_by_role_check'
      ) THEN
        ALTER TABLE order_entries
        ADD CONSTRAINT order_entries_created_by_role_check
        CHECK (created_by_role IN ('Owner', 'Lager', 'Worker', 'Customer'));
      END IF;
    END $$;
  `,
  `
    CREATE INDEX IF NOT EXISTS order_entries_status_created_idx
    ON order_entries (status, created_at DESC);
  `
];
