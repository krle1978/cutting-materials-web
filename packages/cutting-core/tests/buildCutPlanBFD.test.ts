import { describe, expect, it } from "vitest";
import { buildCutPlanBFD } from "../src/index";

describe("buildCutPlanBFD", () => {
  it("returns SUCCESS when inventory can fulfill all pieces", () => {
    const result = buildCutPlanBFD({
      inventoryItems: [{ id: 1, lengthMm: 5000, qty: 2 }],
      orderLines: [{ heightMm: 1000, widthMm: 1000, qty: 2 }],
      params: { kerfMm: 0, allowanceMm: 0, minRemnantMm: 100 }
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.shortage).toHaveLength(0);
    expect(result.stats.totalPieces).toBe(8);
    expect(result.stats.totalUsedStocks).toBe(2);
  });

  it("returns PARTIAL when inventory is insufficient", () => {
    const result = buildCutPlanBFD({
      inventoryItems: [{ id: 1, lengthMm: 5000, qty: 1 }],
      orderLines: [{ heightMm: 1000, widthMm: 1000, qty: 2 }],
      params: { kerfMm: 0, allowanceMm: 0, minRemnantMm: 100 }
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.shortage).toHaveLength(1);
    expect(result.shortage[0].missingCount).toBe(3);
  });

  it("returns FAIL when longest piece is longer than any stock", () => {
    const result = buildCutPlanBFD({
      inventoryItems: [{ id: 1, lengthMm: 3000, qty: 10 }],
      orderLines: [{ heightMm: 3100, widthMm: 900, qty: 1 }],
      params: { kerfMm: 0, allowanceMm: 0 }
    });

    expect(result.status).toBe("FAIL");
    expect(result.shortage[0].reason).toBe("NO_STOCK_LONG_ENOUGH");
    expect(result.shortage[0].missingCount).toBe(2);
  });

  it("detects when kerf and allowance make longest piece impossible", () => {
    const result = buildCutPlanBFD({
      inventoryItems: [{ id: 1, lengthMm: 3000, qty: 5 }],
      orderLines: [{ heightMm: 3000, widthMm: 500, qty: 1 }],
      params: { kerfMm: 3, allowanceMm: 0 }
    });

    expect(result.status).toBe("FAIL");
    expect(result.shortage[0].reason).toBe("KERF_ALLOWANCE_MAKES_IT_IMPOSSIBLE");
  });

  it("counts remnant below threshold as waste", () => {
    const result = buildCutPlanBFD({
      inventoryItems: [{ id: 1, lengthMm: 5000, qty: 1 }],
      orderLines: [{ heightMm: 1200, widthMm: 1200, qty: 1 }],
      params: { kerfMm: 0, allowanceMm: 0, minRemnantMm: 300 }
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].remnantMm).toBe(200);
    expect(result.allocations[0].remnantKept).toBe(false);
    expect(result.stats.totalWasteMm).toBe(200);
  });

  it("handles many equal stock lengths", () => {
    const result = buildCutPlanBFD({
      inventoryItems: [{ id: 1, lengthMm: 2000, qty: 10 }],
      orderLines: [{ heightMm: 1000, widthMm: 500, qty: 3 }],
      params: { kerfMm: 0, allowanceMm: 0, minRemnantMm: 100 }
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.shortage).toHaveLength(0);
    expect(result.stats.totalPieces).toBe(12);
  });
});
