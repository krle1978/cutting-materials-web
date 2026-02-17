import type { InventoryItem, PlanParams } from "@cutting/contracts";
import type { CutPlanResult, OrderLineMm } from "@cutting/cutting-core";

export type PlanState = "PLANNED" | "COMMITTED" | "EXPIRED";

export type CreatePlanInput = {
  params: PlanParams;
  orderLines: OrderLineMm[];
  result: CutPlanResult;
};

export type CommitPlanResult = {
  status: "COMMITTED" | "ALREADY_COMMITTED";
};

export interface PlanStore {
  migrate(): Promise<void>;
  listInventory(): Promise<InventoryItem[]>;
  addInventory(lengthMm: number, qty: number): Promise<void>;
  createPlan(input: CreatePlanInput): Promise<{ planId: string }>;
  commitPlan(planId: string): Promise<CommitPlanResult>;
  close(): Promise<void>;
}

