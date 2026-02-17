import { randomUUID } from "crypto";
import type { InventoryItem } from "@cutting/contracts";
import type { Allocation } from "@cutting/cutting-core";
import { ConflictError, NotFoundError } from "../utils/errors";
import type {
  CommitPlanResult,
  CreatePlanInput,
  PlanState,
  PlanStore
} from "./types";

type MemoryPlan = CreatePlanInput & {
  id: string;
  status: PlanState;
};

export class MemoryStore implements PlanStore {
  private inventoryById = new Map<number, InventoryItem>();
  private inventoryLengthIndex = new Map<number, number>();
  private plans = new Map<string, MemoryPlan>();
  private nextInventoryId = 1;

  async migrate(): Promise<void> {
    return Promise.resolve();
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }

  async listInventory(): Promise<InventoryItem[]> {
    return [...this.inventoryById.values()]
      .filter((item) => item.qty > 0)
      .sort((a, b) => a.lengthMm - b.lengthMm);
  }

  async addInventory(lengthMm: number, qty: number): Promise<void> {
    const existingId = this.inventoryLengthIndex.get(lengthMm);
    if (existingId) {
      const existing = this.inventoryById.get(existingId);
      if (!existing) {
        throw new Error("Inventory index is corrupted");
      }
      existing.qty += qty;
      return;
    }

    const id = this.nextInventoryId;
    this.nextInventoryId += 1;

    this.inventoryById.set(id, {
      id,
      lengthMm,
      qty
    });
    this.inventoryLengthIndex.set(lengthMm, id);
  }

  async createPlan(input: CreatePlanInput): Promise<{ planId: string }> {
    const planId = randomUUID();
    this.plans.set(planId, {
      id: planId,
      status: "PLANNED",
      params: input.params,
      orderLines: input.orderLines,
      result: input.result
    });

    return { planId };
  }

  async commitPlan(planId: string): Promise<CommitPlanResult> {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new NotFoundError("Plan not found");
    }

    if (plan.status === "COMMITTED") {
      return { status: "ALREADY_COMMITTED" };
    }

    const requiredBySource = summarizeConsumption(plan.result.allocations);
    for (const [sourceId, requiredCount] of requiredBySource.entries()) {
      const stock = this.inventoryById.get(sourceId);
      if (!stock || stock.qty < requiredCount) {
        throw new ConflictError("Inventory changed, plan cannot be committed");
      }
    }

    for (const [sourceId, requiredCount] of requiredBySource.entries()) {
      const stock = this.inventoryById.get(sourceId);
      if (!stock) {
        throw new ConflictError("Inventory changed, plan cannot be committed");
      }
      stock.qty -= requiredCount;
    }

    const remnantMap = summarizeRemnants(plan.result.allocations);
    for (const [lengthMm, qty] of remnantMap.entries()) {
      await this.addInventory(lengthMm, qty);
    }

    plan.status = "COMMITTED";
    return { status: "COMMITTED" };
  }
}

function summarizeConsumption(allocations: Allocation[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const allocation of allocations) {
    const sourceId = allocation.stock.sourceId;
    map.set(sourceId, (map.get(sourceId) ?? 0) + 1);
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

