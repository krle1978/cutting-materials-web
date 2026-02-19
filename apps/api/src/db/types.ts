import type { InventoryClass, InventoryItem, PlanParams } from "@cutting/contracts";
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

export type OrderQueueStatus = "PENDING" | "ACCEPTED";

export type CreateOrderInput = {
  inventoryClass: InventoryClass;
  heightMm: number | null;
  widthMm: number;
  qty: number;
  widthOnly: boolean;
  derivedFromWidth: boolean;
};

export type OrderQueueItem = {
  id: string;
  inventoryClass: InventoryClass;
  heightMm: number | null;
  widthMm: number;
  qty: number;
  widthOnly: boolean;
  derivedFromWidth: boolean;
  status: OrderQueueStatus;
  createdAt: string;
  acceptedAt: string | null;
  acceptedPlanIds: string[];
};

export interface PlanStore {
  migrate(): Promise<void>;
  listInventory(): Promise<InventoryItem[]>;
  addInventory(lengthMm: number, qty: number, inventoryClass: InventoryClass): Promise<void>;
  createPlan(input: CreatePlanInput): Promise<{ planId: string }>;
  commitPlan(planId: string): Promise<CommitPlanResult>;
  createOrders(input: CreateOrderInput[]): Promise<OrderQueueItem[]>;
  listOrders(): Promise<OrderQueueItem[]>;
  getOrderById(orderId: string): Promise<OrderQueueItem | null>;
  markOrderAccepted(orderId: string, acceptedPlanIds: string[]): Promise<OrderQueueItem>;
  close(): Promise<void>;
}
