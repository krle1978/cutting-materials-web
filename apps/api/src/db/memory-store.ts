import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import type { InventoryClass, InventoryItem } from "@cutting/contracts";
import type { Allocation } from "@cutting/cutting-core";
import { ConflictError, NotFoundError } from "../utils/errors";
import type {
  CommitPlanResult,
  CreateOrderInput,
  CreatePlanInput,
  OrderQueueItem,
  OrderQueueStatus,
  PlanState,
  PlanStore
} from "./types";

type MemoryPlan = CreatePlanInput & {
  id: string;
  status: PlanState;
};

const DEFAULT_INVENTORY: Array<{ inventoryClass: InventoryClass; lengthMm: number; qty: number }> = [
  { inventoryClass: "Komarnici", lengthMm: 3000, qty: 5 },
  { inventoryClass: "Komarnici", lengthMm: 5000, qty: 3 },
  { inventoryClass: "Komarnici", lengthMm: 7000, qty: 6 },
  { inventoryClass: "Prozorske daske", lengthMm: 10000, qty: 10 },
  { inventoryClass: "Prozorske daske", lengthMm: 20000, qty: 15 }
];
const DEFAULT_INVENTORY_CLASS: InventoryClass = "Komarnici";

type PersistedMemoryState = {
  inventory: Array<{
    id: number;
    inventoryClass?: unknown;
    lengthMm: number;
    qty: number;
  }>;
  orders?: Array<{
    id?: unknown;
    inventoryClass?: unknown;
    heightMm?: unknown;
    widthMm?: unknown;
    qty?: unknown;
    widthOnly?: unknown;
    derivedFromWidth?: unknown;
    status?: unknown;
    createdAt?: unknown;
    acceptedAt?: unknown;
    acceptedPlanIds?: unknown;
  }>;
  nextInventoryId: number;
};

export class MemoryStore implements PlanStore {
  private inventoryById = new Map<number, InventoryItem>();
  private inventoryKeyIndex = new Map<string, number>();
  private plans = new Map<string, MemoryPlan>();
  private orders = new Map<string, OrderQueueItem>();
  private nextInventoryId = 1;
  private readonly stateFilePath = resolveMemoryStateFilePath();

  async migrate(): Promise<void> {
    await this.loadPersistedState();

    if (this.inventoryById.size === 0) {
      for (const item of DEFAULT_INVENTORY) {
        await this.addInventoryInternal(item.lengthMm, item.qty, item.inventoryClass, false);
      }
      await this.persistState();
    }
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }

  async listInventory(): Promise<InventoryItem[]> {
    this.repairLegacyInventory();

    return [...this.inventoryById.values()]
      .filter((item) => item.qty > 0)
      .sort((a, b) => {
        const classOrder = a.inventoryClass.localeCompare(b.inventoryClass);
        if (classOrder !== 0) {
          return classOrder;
        }
        return a.lengthMm - b.lengthMm;
      });
  }

  async addInventory(
    lengthMm: number,
    qty: number,
    inventoryClass: InventoryClass = DEFAULT_INVENTORY_CLASS
  ): Promise<void> {
    await this.addInventoryInternal(lengthMm, qty, inventoryClass, true);
  }

  async createOrders(input: CreateOrderInput[]): Promise<OrderQueueItem[]> {
    const createdAt = new Date().toISOString();
    const created: OrderQueueItem[] = input.map((entry) => ({
      id: randomUUID(),
      inventoryClass: normalizeInventoryClass(entry.inventoryClass),
      heightMm: toNullablePositiveInt(entry.heightMm),
      widthMm: toPositiveInt(entry.widthMm),
      qty: toPositiveInt(entry.qty),
      widthOnly: entry.widthOnly === true,
      derivedFromWidth: entry.derivedFromWidth === true,
      status: "PENDING",
      createdAt,
      acceptedAt: null,
      acceptedPlanIds: []
    }));

    for (const order of created) {
      this.orders.set(order.id, order);
    }

    await this.persistState();
    return created.map(cloneOrder);
  }

  async listOrders(): Promise<OrderQueueItem[]> {
    return [...this.orders.values()]
      .sort((a, b) => {
        if (a.createdAt === b.createdAt) {
          return a.id.localeCompare(b.id);
        }
        return b.createdAt.localeCompare(a.createdAt);
      })
      .map(cloneOrder);
  }

  async getOrderById(orderId: string): Promise<OrderQueueItem | null> {
    const order = this.orders.get(orderId);
    return order ? cloneOrder(order) : null;
  }

  async markOrderAccepted(orderId: string, acceptedPlanIds: string[]): Promise<OrderQueueItem> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new NotFoundError("Order not found");
    }

    if (order.status !== "ACCEPTED") {
      order.status = "ACCEPTED";
      order.acceptedAt = new Date().toISOString();
      order.acceptedPlanIds = [...acceptedPlanIds];
      await this.persistState();
    }

    return cloneOrder(order);
  }

  private async addInventoryInternal(
    lengthMm: number,
    qty: number,
    inventoryClass: InventoryClass = DEFAULT_INVENTORY_CLASS,
    persist = true
  ): Promise<void> {
    this.repairLegacyInventory();
    const normalizedClass = normalizeInventoryClass(inventoryClass);
    const key = toInventoryKey(lengthMm, normalizedClass);
    const existingId = this.inventoryKeyIndex.get(key);
    if (existingId) {
      const existing = this.inventoryById.get(existingId);
      if (!existing) {
        throw new Error("Inventory index is corrupted");
      }
      existing.qty += qty;
      if (persist) {
        await this.persistState();
      }
      return;
    }

    const id = this.nextInventoryId;
    this.nextInventoryId += 1;

    this.inventoryById.set(id, {
      id,
      inventoryClass: normalizedClass,
      lengthMm,
      qty
    });
    this.inventoryKeyIndex.set(key, id);

    if (persist) {
      await this.persistState();
    }
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
    this.repairLegacyInventory();

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

    const remnantMap = summarizeRemnants(plan.result.allocations, (sourceId) => {
      const stock = this.inventoryById.get(sourceId);
      if (!stock) {
        throw new ConflictError("Inventory changed, plan cannot be committed");
      }
      return normalizeInventoryClass(stock.inventoryClass);
    });
    for (const remnant of remnantMap.values()) {
      await this.addInventoryInternal(remnant.lengthMm, remnant.qty, remnant.inventoryClass, false);
    }

    plan.status = "COMMITTED";
    await this.persistState();
    return { status: "COMMITTED" };
  }

  private repairLegacyInventory(): void {
    this.inventoryKeyIndex.clear();
    for (const item of this.inventoryById.values()) {
      item.inventoryClass = normalizeInventoryClass(item.inventoryClass);
      const key = toInventoryKey(item.lengthMm, item.inventoryClass);
      if (!this.inventoryKeyIndex.has(key)) {
        this.inventoryKeyIndex.set(key, item.id);
      }
    }
  }

  private async loadPersistedState(): Promise<void> {
    if (!existsSync(this.stateFilePath)) {
      return;
    }

    const raw = await readFile(this.stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedMemoryState;

    this.inventoryById.clear();
    this.inventoryKeyIndex.clear();
    this.orders.clear();

    let maxId = 0;
    for (const item of parsed.inventory ?? []) {
      const id = toPositiveInt(item.id);
      const lengthMm = toPositiveInt(item.lengthMm);
      const qty = toNonNegativeInt(item.qty);
      if (id <= 0 || lengthMm <= 0) {
        continue;
      }

      const inventoryClass = normalizeInventoryClass(item.inventoryClass);
      this.inventoryById.set(id, {
        id,
        inventoryClass,
        lengthMm,
        qty
      });
      maxId = Math.max(maxId, id);
    }

    for (const item of parsed.orders ?? []) {
      if (typeof item.id !== "string" || item.id.length === 0) {
        continue;
      }
      const widthMm = toPositiveInt(toNumber(item.widthMm));
      const qty = toPositiveInt(toNumber(item.qty));
      if (widthMm <= 0 || qty <= 0) {
        continue;
      }

      const inventoryClass = normalizeInventoryClass(item.inventoryClass);
      const order: OrderQueueItem = {
        id: item.id,
        inventoryClass,
        heightMm: toNullablePositiveInt(item.heightMm),
        widthMm,
        qty,
        widthOnly: item.widthOnly === true,
        derivedFromWidth: item.derivedFromWidth === true,
        status: normalizeOrderStatus(item.status),
        createdAt: typeof item.createdAt === "string" && item.createdAt.length > 0 ? item.createdAt : new Date().toISOString(),
        acceptedAt:
          typeof item.acceptedAt === "string" && item.acceptedAt.length > 0 ? item.acceptedAt : null,
        acceptedPlanIds: Array.isArray(item.acceptedPlanIds)
          ? item.acceptedPlanIds.filter((x): x is string => typeof x === "string")
          : []
      };

      this.orders.set(order.id, order);
    }

    this.repairLegacyInventory();
    this.nextInventoryId = Math.max(toPositiveInt(parsed.nextInventoryId), maxId + 1);
  }

  private async persistState(): Promise<void> {
    const state: PersistedMemoryState = {
      inventory: [...this.inventoryById.values()],
      orders: [...this.orders.values()],
      nextInventoryId: this.nextInventoryId
    };

    await mkdir(dirname(this.stateFilePath), { recursive: true });
    await writeFile(this.stateFilePath, JSON.stringify(state, null, 2), "utf8");
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

function summarizeRemnants(
  allocations: Allocation[],
  resolveInventoryClass: (sourceId: number) => InventoryClass
): Map<string, { inventoryClass: InventoryClass; lengthMm: number; qty: number }> {
  const map = new Map<string, { inventoryClass: InventoryClass; lengthMm: number; qty: number }>();
  for (const allocation of allocations) {
    if (!allocation.remnantKept) {
      continue;
    }
    const inventoryClass = resolveInventoryClass(allocation.stock.sourceId);
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

function normalizeInventoryClass(value: unknown): InventoryClass {
  if (value === "Komarnici" || value === "Prozorske daske") {
    return value;
  }
  return DEFAULT_INVENTORY_CLASS;
}

function normalizeOrderStatus(value: unknown): OrderQueueStatus {
  return value === "ACCEPTED" ? "ACCEPTED" : "PENDING";
}

function toPositiveInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

function toNullablePositiveInt(value: unknown): number | null {
  const parsed = toPositiveInt(toNumber(value));
  return parsed > 0 ? parsed : null;
}

function toNonNegativeInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function cloneOrder(order: OrderQueueItem): OrderQueueItem {
  return {
    ...order,
    acceptedPlanIds: [...order.acceptedPlanIds]
  };
}

function resolveMemoryStateFilePath(): string {
  const apiDirFromRoot = resolve(process.cwd(), "apps", "api");
  if (existsSync(apiDirFromRoot)) {
    return resolve(apiDirFromRoot, ".data", "memory-store.json");
  }

  return resolve(process.cwd(), ".data", "memory-store.json");
}
