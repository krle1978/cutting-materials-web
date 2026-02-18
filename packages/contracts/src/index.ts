import { z } from "zod";

export const DEFAULT_PLAN_PARAMS = {
  kerfMm: 3,
  allowanceMm: 1,
  minRemnantMm: 100,
  toleranceMm: 1
} as const;

export const unitsSchema = z.enum(["mm", "cm", "m"]);
export type Units = z.infer<typeof unitsSchema>;

export const planParamsSchema = z.object({
  kerfMm: z.number().int().min(0),
  allowanceMm: z.number().int().min(0),
  minRemnantMm: z.number().int().min(0),
  toleranceMm: z.number().int().min(0)
});
export type PlanParams = z.infer<typeof planParamsSchema>;

export const planParamsPatchSchema = z.object({
  kerfMm: z.number().int().min(0).optional(),
  allowanceMm: z.number().int().min(0).optional(),
  minRemnantMm: z.number().int().min(0).optional(),
  toleranceMm: z.number().int().min(0).optional()
});
export type PlanParamsPatch = z.infer<typeof planParamsPatchSchema>;

export const inventoryClassSchema = z.enum(["Komarnici", "Prozorske daske"]);
export type InventoryClass = z.infer<typeof inventoryClassSchema>;

export const inventoryItemSchema = z.object({
  id: z.number().int().positive(),
  inventoryClass: inventoryClassSchema,
  lengthMm: z.number().int().positive(),
  qty: z.number().int().min(0)
});
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

export const inventoryAddRequestSchema = z.object({
  inventoryClass: inventoryClassSchema,
  lengthMm: z.number().int().positive(),
  qty: z.number().int().positive()
});
export type InventoryAddRequest = z.infer<typeof inventoryAddRequestSchema>;

export const orderLineInputSchema = z.object({
  height: z.number().positive(),
  width: z.number().positive(),
  qty: z.number().int().positive()
});
export type OrderLineInput = z.infer<typeof orderLineInputSchema>;

export const orderPlanRequestSchema = z.object({
  units: unitsSchema.default("mm"),
  params: planParamsPatchSchema.default({}),
  orderLines: z.array(orderLineInputSchema).min(1)
});
export type OrderPlanRequest = z.infer<typeof orderPlanRequestSchema>;

export const orderCommitRequestSchema = z.object({
  planId: z.string().uuid()
});
export type OrderCommitRequest = z.infer<typeof orderCommitRequestSchema>;

export const planStatusSchema = z.enum(["SUCCESS", "PARTIAL", "FAIL"]);
export type PlanStatus = z.infer<typeof planStatusSchema>;

export const shortageReasonSchema = z.enum([
  "NO_STOCK_LONG_ENOUGH",
  "KERF_ALLOWANCE_MAKES_IT_IMPOSSIBLE",
  "INSUFFICIENT_STOCK_AFTER_ALLOCATION"
]);
export type ShortageReason = z.infer<typeof shortageReasonSchema>;

export function mergePlanParams(patch?: PlanParamsPatch): PlanParams {
  return {
    kerfMm: patch?.kerfMm ?? DEFAULT_PLAN_PARAMS.kerfMm,
    allowanceMm: patch?.allowanceMm ?? DEFAULT_PLAN_PARAMS.allowanceMm,
    minRemnantMm: patch?.minRemnantMm ?? DEFAULT_PLAN_PARAMS.minRemnantMm,
    toleranceMm: patch?.toleranceMm ?? DEFAULT_PLAN_PARAMS.toleranceMm
  };
}
