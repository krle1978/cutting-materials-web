import {
  type InventoryClass,
  mergePlanParams,
  orderCommitRequestSchema,
  orderPlanRequestSchema,
  orderQueueCreateRequestSchema
} from "@cutting/contracts";
import {
  buildCutPlanBFD,
  buildCutPlanBFDForPieces,
  type CutPlanResult,
  type OrderLineMm
} from "@cutting/cutting-core";
import type { FastifyInstance } from "fastify";
import type { OrderQueueItem, PlanStore } from "../db/types";
import { ConflictError, NotFoundError } from "../utils/errors";
import { toMillimeters } from "../utils/units";

type OrdersRoutesOptions = {
  store: PlanStore;
};

const DEFAULT_INVENTORY_CLASS: InventoryClass = "Komarnici";

export async function registerOrdersRoutes(
  app: FastifyInstance,
  options: OrdersRoutesOptions
): Promise<void> {
  app.get("/orders", async () => {
    const items = await options.store.listOrders();
    return { items };
  });

  app.post("/orders", async (request, reply) => {
    const parsed = orderQueueCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        ok: false,
        error: "Invalid request body",
        details: parsed.error.issues
      };
    }

    const items = parsed.data.rows.map((row) => ({
      inventoryClass: row.inventoryClass,
      heightMm: row.height == null ? null : toMillimeters(row.height, parsed.data.units),
      widthMm: toMillimeters(row.width, parsed.data.units),
      qty: Math.round(row.qty),
      widthOnly: row.widthOnly === true,
      derivedFromWidth: row.derivedFromWidth === true
    }));

    const hasInvalidLength = items.some((item) => {
      const hasInvalidHeight = item.heightMm != null && item.heightMm <= 0;
      return hasInvalidHeight || item.widthMm <= 0 || item.qty <= 0;
    });

    if (hasInvalidLength) {
      reply.code(400);
      return {
        ok: false,
        error: "Order rows must be positive after unit normalization"
      };
    }

    const created = await options.store.createOrders(items);
    const allItems = await options.store.listOrders();
    return {
      ok: true,
      created,
      items: allItems
    };
  });

  app.post<{ Params: { orderId: string } }>("/orders/:orderId/accept", async (request, reply) => {
    try {
      const result = await acceptStoredOrder(request.params.orderId, options.store);
      const items = await options.store.listOrders();
      const inventory = await options.store.listInventory();
      return {
        ok: true,
        ...result,
        items,
        inventory
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        reply.code(404);
        return { ok: false, error: error.message };
      }
      if (error instanceof ConflictError) {
        reply.code(409);
        return { ok: false, error: error.message };
      }
      throw error;
    }
  });

  app.post("/orders/accept-all", async () => {
    const allOrders = await options.store.listOrders();
    const pending = allOrders.filter((item) => item.status === "PENDING");

    const results: Array<{
      orderId: string;
      status: "ACCEPTED" | "ALREADY_ACCEPTED" | "FAILED";
      error?: string;
      plan?: CutPlanResult & { planId: string };
    }> = [];

    for (const order of pending) {
      try {
        const result = await acceptStoredOrder(order.id, options.store);
        results.push({
          orderId: order.id,
          status: result.status,
          plan: result.plan
        });
      } catch (error) {
        results.push({
          orderId: order.id,
          status: "FAILED",
          error: error instanceof Error ? error.message : "Unexpected error"
        });
      }
    }

    const items = await options.store.listOrders();
    const inventory = await options.store.listInventory();

    return {
      ok: true,
      results,
      items,
      inventory
    };
  });

  app.post("/orders/plan", async (request, reply) => {
    const parsed = orderPlanRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        ok: false,
        error: "Invalid request body",
        details: parsed.error.issues
      };
    }

    const params = mergePlanParams(parsed.data.params);
    const inventoryClass = resolveInventoryClass(request.body);
    const widthOnly = resolveWidthOnly(request.body);

    const orderLinesMm: OrderLineMm[] = parsed.data.orderLines.map((line) => ({
      heightMm: toMillimeters(line.height, parsed.data.units),
      widthMm: toMillimeters(line.width, parsed.data.units),
      qty: Math.round(line.qty)
    }));

    const hasInvalidLength = orderLinesMm.some(
      (line) => line.heightMm <= 0 || line.widthMm <= 0 || line.qty <= 0
    );

    if (hasInvalidLength) {
      reply.code(400);
      return {
        ok: false,
        error: "Order lines must be positive after unit normalization"
      };
    }

    const inventoryItems = (await options.store.listInventory()).filter(
      (item) => item.inventoryClass === inventoryClass
    );
    const planResult = widthOnly
      ? buildCutPlanBFDForPieces({
          inventoryItems,
          piecesMm: expandOrderWidthsToPieces(orderLinesMm),
          params
        })
      : buildCutPlanBFD({
          inventoryItems,
          orderLines: orderLinesMm,
          params
        });

    const { planId } = await options.store.createPlan({
      params,
      orderLines: orderLinesMm,
      result: planResult
    });

    return {
      ...planResult,
      planId,
      inventoryClass,
      widthOnly
    };
  });

  app.post("/orders/commit", async (request, reply) => {
    const parsed = orderCommitRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        ok: false,
        error: "Invalid request body",
        details: parsed.error.issues
      };
    }

    try {
      const result = await options.store.commitPlan(parsed.data.planId);
      const items = await options.store.listInventory();
      return {
        ok: true,
        status: result.status,
        inventory: {
          changed: result.status === "COMMITTED",
          items
        }
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        reply.code(404);
        return { ok: false, error: error.message };
      }
      if (error instanceof ConflictError) {
        reply.code(409);
        return { ok: false, error: error.message };
      }
      throw error;
    }
  });
}

async function acceptStoredOrder(orderId: string, store: PlanStore): Promise<{
  status: "ACCEPTED" | "ALREADY_ACCEPTED";
  order: OrderQueueItem;
  plan?: CutPlanResult & { planId: string };
}> {
  const order = await store.getOrderById(orderId);
  if (!order) {
    throw new NotFoundError("Order not found");
  }

  if (order.status === "ACCEPTED") {
    return {
      status: "ALREADY_ACCEPTED",
      order
    };
  }

  const params = mergePlanParams();
  const orderLines: OrderLineMm[] = [
    {
      heightMm: order.heightMm ?? order.widthMm,
      widthMm: order.widthMm,
      qty: order.qty
    }
  ];

  const inventoryItems = (await store.listInventory()).filter(
    (item) => item.inventoryClass === order.inventoryClass
  );

  const plan = order.widthOnly
    ? buildCutPlanBFDForPieces({
        inventoryItems,
        piecesMm: expandOrderWidthsToPieces(orderLines),
        params
      })
    : buildCutPlanBFD({
        inventoryItems,
        orderLines,
        params
      });

  const { planId } = await store.createPlan({
    params,
    orderLines,
    result: plan
  });

  await store.commitPlan(planId);
  const acceptedOrder = await store.markOrderAccepted(order.id, [planId]);

  return {
    status: "ACCEPTED",
    order: acceptedOrder,
    plan: {
      ...plan,
      planId
    }
  };
}

function resolveInventoryClass(body: unknown): InventoryClass {
  if (!isRecord(body)) {
    return DEFAULT_INVENTORY_CLASS;
  }
  const value = body.inventoryClass;
  if (value === "Komarnici" || value === "Prozorske daske") {
    return value;
  }
  return DEFAULT_INVENTORY_CLASS;
}

function resolveWidthOnly(body: unknown): boolean {
  if (!isRecord(body)) {
    return false;
  }
  return body.widthOnly === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function expandOrderWidthsToPieces(orderLines: OrderLineMm[]): number[] {
  const pieces: number[] = [];
  for (const line of orderLines) {
    const widthMm = Math.max(0, Math.round(line.widthMm));
    const qty = Math.max(0, Math.round(line.qty));
    for (let i = 0; i < 2 * qty; i += 1) {
      pieces.push(widthMm);
    }
  }
  return pieces;
}
