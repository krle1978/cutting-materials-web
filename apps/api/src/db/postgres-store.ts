import { randomUUID } from "crypto";
import { Pool } from "pg";
import type { InventoryClass, InventoryItem } from "@cutting/contracts";
import type { Allocation, CutPlanResult } from "@cutting/cutting-core";
import { ConflictError, NotFoundError } from "../utils/errors";
import { migrationStatements } from "./sql";
import type {
  CommitPlanResult,
  CreateOrderInput,
  CreatePlanInput,
  OrderQueueItem,
  PlanStore
} from "./types";

export class PostgresStore implements PlanStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async migrate(): Promise<void> {
    for (const statement of migrationStatements) {
      await this.pool.query(statement);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listInventory(): Promise<InventoryItem[]> {
    const { rows } = await this.pool.query<{
      id: number;
      inventory_class: InventoryClass;
      length_mm: number;
      qty: number;
    }>(`
      SELECT id, inventory_class, length_mm, qty
      FROM inventory
      WHERE qty > 0
      ORDER BY inventory_class ASC, length_mm ASC
    `);

    return rows.map((row) => ({
      id: row.id,
      inventoryClass: row.inventory_class,
      lengthMm: row.length_mm,
      qty: row.qty
    }));
  }

  async addInventory(lengthMm: number, qty: number, inventoryClass: InventoryClass): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO inventory (inventory_class, length_mm, qty)
        VALUES ($1, $2, $3)
        ON CONFLICT (inventory_class, length_mm)
        DO UPDATE SET qty = inventory.qty + EXCLUDED.qty
      `,
      [inventoryClass, lengthMm, qty]
    );
  }

  async createPlan(input: CreatePlanInput): Promise<{ planId: string }> {
    const planId = randomUUID();
    await this.pool.query(
      `
        INSERT INTO plans (id, status, params_json, order_json, result_json)
        VALUES ($1, 'PLANNED', $2, $3, $4)
      `,
      [planId, JSON.stringify(input.params), JSON.stringify(input.orderLines), JSON.stringify(input.result)]
    );

    return { planId };
  }

  async commitPlan(planId: string): Promise<CommitPlanResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const plan = await client.query<{
        status: string;
        result_json: CutPlanResult;
      }>(
        `
          SELECT status, result_json
          FROM plans
          WHERE id = $1
          FOR UPDATE
        `,
        [planId]
      );

      if (plan.rowCount === 0) {
        throw new NotFoundError("Plan not found");
      }

      const planStatus = plan.rows[0].status;
      if (planStatus === "COMMITTED") {
        await client.query("COMMIT");
        return { status: "ALREADY_COMMITTED" };
      }

      const result = plan.rows[0].result_json;
      const consumptionBySource = summarizeConsumption(result.allocations);
      const sourceClassById = new Map<number, InventoryClass>();

      for (const [sourceId, usedCount] of consumptionBySource.entries()) {
        const updated = await client.query<{ inventory_class: InventoryClass }>(
          `
            UPDATE inventory
            SET qty = qty - $2
            WHERE id = $1 AND qty >= $2
            RETURNING inventory_class
          `,
          [sourceId, usedCount]
        );

        if (updated.rowCount === 0) {
          throw new ConflictError("Inventory changed, plan cannot be committed");
        }

        sourceClassById.set(sourceId, updated.rows[0].inventory_class);
      }

      const remnantByClassAndLength = summarizeRemnants(result.allocations, sourceClassById);
      for (const remnant of remnantByClassAndLength.values()) {
        await client.query(
          `
            INSERT INTO inventory (inventory_class, length_mm, qty)
            VALUES ($1, $2, $3)
            ON CONFLICT (inventory_class, length_mm)
            DO UPDATE SET qty = inventory.qty + EXCLUDED.qty
          `,
          [remnant.inventoryClass, remnant.lengthMm, remnant.qty]
        );
      }

      await client.query(
        `
          UPDATE plans
          SET status = 'COMMITTED', committed_at = NOW()
          WHERE id = $1
        `,
        [planId]
      );

      await client.query("COMMIT");
      return { status: "COMMITTED" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createOrders(input: CreateOrderInput[]): Promise<OrderQueueItem[]> {
    const created: OrderQueueItem[] = [];

    for (const entry of input) {
      const orderId = randomUUID();
      const { rows } = await this.pool.query<OrderRow>(
        `
          INSERT INTO order_entries (
            id,
            inventory_class,
            height_mm,
            width_mm,
            qty,
            width_only,
            derived_from_width,
            status,
            accepted_plan_ids
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', '[]'::jsonb)
          RETURNING
            id,
            inventory_class,
            height_mm,
            width_mm,
            qty,
            width_only,
            derived_from_width,
            status,
            created_at,
            accepted_at,
            accepted_plan_ids
        `,
        [
          orderId,
          entry.inventoryClass,
          entry.heightMm,
          entry.widthMm,
          entry.qty,
          entry.widthOnly,
          entry.derivedFromWidth
        ]
      );
      created.push(mapOrderRow(rows[0]));
    }

    return created;
  }

  async listOrders(): Promise<OrderQueueItem[]> {
    const { rows } = await this.pool.query<OrderRow>(`
      SELECT
        id,
        inventory_class,
        height_mm,
        width_mm,
        qty,
        width_only,
        derived_from_width,
        status,
        created_at,
        accepted_at,
        accepted_plan_ids
      FROM order_entries
      ORDER BY created_at DESC, id DESC
    `);

    return rows.map(mapOrderRow);
  }

  async getOrderById(orderId: string): Promise<OrderQueueItem | null> {
    const { rows } = await this.pool.query<OrderRow>(
      `
      SELECT
        id,
        inventory_class,
        height_mm,
        width_mm,
        qty,
        width_only,
        derived_from_width,
        status,
        created_at,
        accepted_at,
        accepted_plan_ids
      FROM order_entries
      WHERE id = $1
    `,
      [orderId]
    );

    if (rows.length === 0) {
      return null;
    }

    return mapOrderRow(rows[0]);
  }

  async markOrderAccepted(orderId: string, acceptedPlanIds: string[]): Promise<OrderQueueItem> {
    const existing = await this.getOrderById(orderId);
    if (!existing) {
      throw new NotFoundError("Order not found");
    }

    if (existing.status === "ACCEPTED") {
      return existing;
    }

    const { rows } = await this.pool.query<OrderRow>(
      `
      UPDATE order_entries
      SET status = 'ACCEPTED',
          accepted_at = NOW(),
          accepted_plan_ids = $2::jsonb
      WHERE id = $1
      RETURNING
        id,
        inventory_class,
        height_mm,
        width_mm,
        qty,
        width_only,
        derived_from_width,
        status,
        created_at,
        accepted_at,
        accepted_plan_ids
    `,
      [orderId, JSON.stringify(acceptedPlanIds)]
    );

    if (rows.length === 0) {
      throw new NotFoundError("Order not found");
    }

    return mapOrderRow(rows[0]);
  }
}

type OrderRow = {
  id: string;
  inventory_class: InventoryClass;
  height_mm: number | null;
  width_mm: number;
  qty: number;
  width_only: boolean;
  derived_from_width: boolean;
  status: "PENDING" | "ACCEPTED";
  created_at: Date | string;
  accepted_at: Date | string | null;
  accepted_plan_ids: unknown;
};

function summarizeConsumption(allocations: Allocation[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const allocation of allocations) {
    map.set(allocation.stock.sourceId, (map.get(allocation.stock.sourceId) ?? 0) + 1);
  }
  return map;
}

function summarizeRemnants(
  allocations: Allocation[],
  sourceClassById: Map<number, InventoryClass>
): Map<string, { inventoryClass: InventoryClass; lengthMm: number; qty: number }> {
  const map = new Map<string, { inventoryClass: InventoryClass; lengthMm: number; qty: number }>();
  for (const allocation of allocations) {
    if (!allocation.remnantKept) {
      continue;
    }

    const inventoryClass = sourceClassById.get(allocation.stock.sourceId);
    if (!inventoryClass) {
      throw new ConflictError("Inventory changed, plan cannot be committed");
    }

    const key = toInventoryKey(allocation.remnantMm, inventoryClass);
    const existing = map.get(key);
    if (existing) {
      existing.qty += 1;
      continue;
    }
    map.set(key, {
      inventoryClass,
      lengthMm: allocation.remnantMm,
      qty: 1
    });
  }
  return map;
}

function toInventoryKey(lengthMm: number, inventoryClass: InventoryClass): string {
  return `${inventoryClass}:${lengthMm}`;
}

function mapOrderRow(row: OrderRow): OrderQueueItem {
  return {
    id: row.id,
    inventoryClass: row.inventory_class,
    heightMm: row.height_mm,
    widthMm: row.width_mm,
    qty: row.qty,
    widthOnly: row.width_only,
    derivedFromWidth: row.derived_from_width,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    acceptedAt: row.accepted_at ? toIsoString(row.accepted_at) : null,
    acceptedPlanIds: Array.isArray(row.accepted_plan_ids)
      ? row.accepted_plan_ids.filter((x): x is string => typeof x === "string")
      : []
  };
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}
