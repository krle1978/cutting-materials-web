const DEFAULT_PLAN_PARAMS = {
  kerfMm: 3,
  allowanceMm: 1,
  minRemnantMm: 100,
  toleranceMm: 1
} as const;

export type InventoryItem = {
  id: number;
  lengthMm: number;
  qty: number;
};

export type PlanParams = {
  kerfMm: number;
  allowanceMm: number;
  minRemnantMm: number;
  toleranceMm: number;
};

export type PlanStatus = "SUCCESS" | "PARTIAL" | "FAIL";

export type ShortageReason =
  | "NO_STOCK_LONG_ENOUGH"
  | "KERF_ALLOWANCE_MAKES_IT_IMPOSSIBLE"
  | "INSUFFICIENT_STOCK_AFTER_ALLOCATION";

export type OrderLineMm = {
  heightMm: number;
  widthMm: number;
  qty: number;
};

export type CutPiece = {
  pieceMm: number;
  effectiveMm: number;
};

export type Allocation = {
  stock: {
    lengthMm: number;
    sourceId: number;
  };
  cuts: CutPiece[];
  usedMm: number;
  remnantMm: number;
  remnantKept: boolean;
};

export type ShortageItem = {
  pieceMm: number;
  missingCount: number;
  reason: ShortageReason;
};

export type CutListItem = {
  pieceMm: number;
  count: number;
};

export type CutPlanStats = {
  totalPieces: number;
  totalUsedStocks: number;
  totalWasteMm: number;
};

export type CutPlanResult = {
  status: PlanStatus;
  cutList: CutListItem[];
  allocations: Allocation[];
  shortage: ShortageItem[];
  stats: CutPlanStats;
};

export type BuildCutPlanInput = {
  inventoryItems: InventoryItem[];
  orderLines: OrderLineMm[];
  params?: Partial<PlanParams>;
};

export type BuildCutPlanForPiecesInput = {
  inventoryItems: InventoryItem[];
  piecesMm: number[];
  params?: Partial<PlanParams>;
};

type MutableBar = {
  sourceId: number;
  originalMm: number;
  remainingMm: number;
  cuts: CutPiece[];
};

export function buildCutPlanBFD({
  inventoryItems,
  orderLines,
  params
}: BuildCutPlanInput): CutPlanResult {
  return buildCutPlanBFDForPieces({
    inventoryItems,
    piecesMm: expandOrderToPieces(orderLines),
    params
  });
}

export function buildCutPlanBFDForPieces({
  inventoryItems,
  piecesMm,
  params
}: BuildCutPlanForPiecesInput): CutPlanResult {
  const normalizedParams = normalizePlanParams(params);
  const pieces = piecesMm.map((piece) => toNonNegativeInt(piece)).filter((piece) => piece > 0);
  pieces.sort((a, b) => b - a);

  return buildPlanFromPieces(inventoryItems, pieces, normalizedParams);
}

function buildPlanFromPieces(
  inventoryItems: InventoryItem[],
  pieces: number[],
  normalizedParams: PlanParams
): CutPlanResult {
  if (pieces.length === 0) {
    return {
      status: "SUCCESS",
      cutList: [],
      allocations: [],
      shortage: [],
      stats: {
        totalPieces: 0,
        totalUsedStocks: 0,
        totalWasteMm: 0
      }
    };
  }

  const longestPiece = pieces[0];
  const longestWithAllowance = longestPiece + normalizedParams.allowanceMm;
  const longestEffective = longestWithAllowance + normalizedParams.kerfMm;
  const maxStock = Math.max(0, ...inventoryItems.map((x) => toNonNegativeInt(x.lengthMm)));

  if (longestEffective > maxStock) {
    const reason: ShortageReason =
      longestWithAllowance <= maxStock
        ? "KERF_ALLOWANCE_MAKES_IT_IMPOSSIBLE"
        : "NO_STOCK_LONG_ENOUGH";

    return {
      status: "FAIL",
      cutList: summarizePieces(pieces),
      allocations: [],
      shortage: [
        {
          pieceMm: longestPiece,
          missingCount: countOf(pieces, longestPiece),
          reason
        }
      ],
      stats: {
        totalPieces: pieces.length,
        totalUsedStocks: 0,
        totalWasteMm: 0
      }
    };
  }

  const bars = expandInventory(inventoryItems);
  const shortageMap = new Map<number, number>();

  for (const piece of pieces) {
    const effectiveMm = piece + normalizedParams.allowanceMm + normalizedParams.kerfMm;
    let bestIdx = -1;
    let bestRemnant = Number.POSITIVE_INFINITY;

    for (let i = 0; i < bars.length; i += 1) {
      const bar = bars[i];
      if (bar.remainingMm < effectiveMm) {
        continue;
      }

      const remnant = bar.remainingMm - effectiveMm;
      if (remnant < bestRemnant) {
        bestRemnant = remnant;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      shortageMap.set(piece, (shortageMap.get(piece) ?? 0) + 1);
      continue;
    }

    bars[bestIdx].cuts.push({ pieceMm: piece, effectiveMm });
    bars[bestIdx].remainingMm -= effectiveMm;
  }

  const allocations: Allocation[] = bars
    .filter((bar) => bar.cuts.length > 0)
    .map((bar) => {
      const usedMm = bar.originalMm - bar.remainingMm;
      const remnantMm = bar.remainingMm;
      return {
        stock: {
          lengthMm: bar.originalMm,
          sourceId: bar.sourceId
        },
        cuts: bar.cuts,
        usedMm,
        remnantMm,
        remnantKept: remnantMm >= normalizedParams.minRemnantMm
      };
    });

  const shortage: ShortageItem[] = [...shortageMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([pieceMm, missingCount]) => ({
      pieceMm,
      missingCount,
      reason: "INSUFFICIENT_STOCK_AFTER_ALLOCATION"
    }));

  const status: PlanStatus =
    shortage.length === 0 ? "SUCCESS" : allocations.length > 0 ? "PARTIAL" : "FAIL";

  const totalWasteMm = allocations.reduce((sum, item) => {
    return sum + (item.remnantKept ? 0 : item.remnantMm);
  }, 0);

  return {
    status,
    cutList: summarizePieces(pieces),
    allocations,
    shortage,
    stats: {
      totalPieces: pieces.length,
      totalUsedStocks: allocations.length,
      totalWasteMm
    }
  };
}

function normalizePlanParams(params?: Partial<PlanParams>): PlanParams {
  return {
    kerfMm: params?.kerfMm ?? DEFAULT_PLAN_PARAMS.kerfMm,
    allowanceMm: params?.allowanceMm ?? DEFAULT_PLAN_PARAMS.allowanceMm,
    minRemnantMm: params?.minRemnantMm ?? DEFAULT_PLAN_PARAMS.minRemnantMm,
    toleranceMm: params?.toleranceMm ?? DEFAULT_PLAN_PARAMS.toleranceMm
  };
}

function expandOrderToPieces(orderLines: OrderLineMm[]): number[] {
  const pieces: number[] = [];

  for (const line of orderLines) {
    const heightMm = toNonNegativeInt(line.heightMm);
    const widthMm = toNonNegativeInt(line.widthMm);
    const qty = toNonNegativeInt(line.qty);

    for (let i = 0; i < 2 * qty; i += 1) {
      pieces.push(heightMm);
      pieces.push(widthMm);
    }
  }

  return pieces.filter((piece) => piece > 0);
}

function expandInventory(items: InventoryItem[]): MutableBar[] {
  const bars: MutableBar[] = [];
  for (const item of items) {
    const lengthMm = toNonNegativeInt(item.lengthMm);
    const qty = toNonNegativeInt(item.qty);

    for (let i = 0; i < qty; i += 1) {
      bars.push({
        sourceId: item.id,
        originalMm: lengthMm,
        remainingMm: lengthMm,
        cuts: []
      });
    }
  }

  return bars;
}

function toNonNegativeInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

function summarizePieces(pieces: number[]): CutListItem[] {
  const map = new Map<number, number>();
  for (const piece of pieces) {
    map.set(piece, (map.get(piece) ?? 0) + 1);
  }

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pieceMm, count]) => ({ pieceMm, count }));
}

function countOf(values: number[], target: number): number {
  let count = 0;
  for (const value of values) {
    if (value === target) {
      count += 1;
    }
  }
  return count;
}
