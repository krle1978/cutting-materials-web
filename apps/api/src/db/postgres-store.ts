import { randomUUID } from "crypto";
import { Pool } from "pg";
import type { InventoryItem } from "@cutting/contracts";
import type { Allocation, CutPlanResult } from "@cutting/cutting-core";
import { ConflictError, NotFoundError } from "../utils/errors";
import { migrationStatements } from "./sql";
import type { CommitPlanResult, CreatePlanInput, PlanStore } from "./types";

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
      length_mm: number;
      qty: number;
    }>(`
      SELECT id, length_mm, qty
      FROM inventory
      WHERE qty > 0
      ORDER BY length_mm ASC
    `);

    return rows.map((row) => ({
      id: row.id,
      lengthMm: row.length_mm,
      qty: row.qty
    }));
  }

  async addInventory(lengthMm: number, qty: number): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO inventory (length_mm, qty)
        VALUES ($1, $2)
        ON CONFLICT (length_mm)
        DO UPDATE SET qty = inventory.qty + EXCLUDED.qty
      `,
      [lengthMm, qty]
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
      const remnantByLength = summarizeRemnants(result.allocations);

      for (const [sourceId, usedCount] of consumptionBySource.entries()) {
        const updated = await client.query(
          `
            UPDATE inventory
            SET qty = qty - $2
            WHERE id = $1 AND qty >= $2
          `,
          [sourceId, usedCount]
        );

        if (updated.rowCount === 0) {
          throw new ConflictError("Inventory changed, plan cannot be committed");
        }
      }

      for (const [lengthMm, qty] of remnantByLength.entries()) {
        await client.query(
          `
            INSERT INTO inventory (length_mm, qty)
            VALUES ($1, $2)
            ON CONFLICT (length_mm)
            DO UPDATE SET qty = inventory.qty + EXCLUDED.qty
          `,
          [lengthMm, qty]
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
}

function summarizeConsumption(allocations: Allocation[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const allocation of allocations) {
    map.set(allocation.stock.sourceId, (map.get(allocation.stock.sourceId) ?? 0) + 1);
  }
  return map;
}

function summarizeRemnants(allocations: Allocation[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const allocation of allocations) {
    if (!allocation.remnantKept) {
      continue;
    }
    map.set(allocation.remnantMm, (map.get(allocation.remnantMm) ?? 0) + 1);
  }
  return map;
}

