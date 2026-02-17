import {
  mergePlanParams,
  orderCommitRequestSchema,
  orderPlanRequestSchema
} from "@cutting/contracts";
import { buildCutPlanBFD, type OrderLineMm } from "@cutting/cutting-core";
import type { FastifyInstance } from "fastify";
import type { PlanStore } from "../db/types";
import { ConflictError, NotFoundError } from "../utils/errors";
import { toMillimeters } from "../utils/units";

type OrdersRoutesOptions = {
  store: PlanStore;
};

export async function registerOrdersRoutes(
  app: FastifyInstance,
  options: OrdersRoutesOptions
): Promise<void> {
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

    const inventoryItems = await options.store.listInventory();
    const planResult = buildCutPlanBFD({
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
      planId
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

