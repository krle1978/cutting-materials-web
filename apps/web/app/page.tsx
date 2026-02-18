"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type InventoryItem = {
  id: number;
  inventoryClass: "Komarnici" | "Prozorske daske";
  lengthMm: number;
  qty: number;
};

type PlanResponse = {
  planId: string;
  status: "SUCCESS" | "PARTIAL" | "FAIL";
  cutList: Array<{ pieceMm: number; count: number }>;
  allocations: Array<{
    stock: { lengthMm: number; sourceId: number };
    cuts: Array<{ pieceMm: number; effectiveMm: number }>;
    usedMm: number;
    remnantMm: number;
    remnantKept: boolean;
  }>;
  shortage: Array<{ pieceMm: number; missingCount: number; reason: string }>;
  stats: {
    totalPieces: number;
    totalUsedStocks: number;
    totalWasteMm: number;
  };
};

const DEFAULT_ORDER_JSON = JSON.stringify(
  [
    { height: 2000, width: 3000, qty: 5 },
    { height: 1800, width: 2500, qty: 3 }
  ],
  null,
  2
);

export default function HomePage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000", []);

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryClass, setInventoryClass] = useState<"Komarnici" | "Prozorske daske">("Komarnici");
  const [inventoryLengthMm, setInventoryLengthMm] = useState("");
  const [inventoryQty, setInventoryQty] = useState("");

  const [units, setUnits] = useState<"mm" | "cm" | "m">("mm");
  const [kerfMm, setKerfMm] = useState("3");
  const [allowanceMm, setAllowanceMm] = useState("1");
  const [minRemnantMm, setMinRemnantMm] = useState("100");
  const [orderLinesJson, setOrderLinesJson] = useState(DEFAULT_ORDER_JSON);

  const [planResponse, setPlanResponse] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filteredInventory = useMemo(() => {
    return inventory
      .filter((item) => item.inventoryClass === inventoryClass)
      .sort((a, b) => a.lengthMm - b.lengthMm);
  }, [inventory, inventoryClass]);

  const loadInventory = useCallback(async () => {
    const response = await fetch(`${apiUrl}/inventory`);
    if (!response.ok) {
      throw new Error(`Inventory fetch failed (${response.status})`);
    }
    const data = (await response.json()) as { items: InventoryItem[] };
    setInventory(data.items ?? []);
  }, [apiUrl]);

  useEffect(() => {
    loadInventory().catch((err: Error) => setError(err.message));
  }, [loadInventory]);

  async function onAddInventory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const lengthMm = Number(inventoryLengthMm);
    const qty = Number(inventoryQty);

    if (!Number.isInteger(lengthMm) || lengthMm < 1 || !Number.isInteger(qty) || qty < 1) {
      setError("Unesi validan Length i Qty (celi brojevi > 0).");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/inventory/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventoryClass,
          lengthMm,
          qty
        })
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Inventory add failed: ${body}`);
      }
      await loadInventory();
      setInventoryLengthMm("");
      setInventoryQty("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function onPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const orderLines = JSON.parse(orderLinesJson);
      const response = await fetch(`${apiUrl}/orders/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          units,
          params: {
            kerfMm: Number(kerfMm),
            allowanceMm: Number(allowanceMm),
            minRemnantMm: Number(minRemnantMm)
          },
          orderLines
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? `Planning failed (${response.status})`);
      }
      setPlanResponse(data as PlanResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    if (!planResponse?.planId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/orders/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: planResponse.planId })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? `Commit failed (${response.status})`);
      }
      await loadInventory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Cutting Optimizer</p>
        <h1>Cutting Materials</h1>
        <p className="sub">
          Frontend na Vercelu, backend na Renderu, zajednički monorepo i BFD algoritam za minimizaciju otpada.
        </p>
      </header>

      <section className="panel">
        <h2>Inventory</h2>
        <form onSubmit={onAddInventory} className="grid">
          <label>
            Klasa
            <select
              value={inventoryClass}
              onChange={(event) => setInventoryClass(event.target.value as "Komarnici" | "Prozorske daske")}
            >
              <option value="Komarnici">Komarnici</option>
              <option value="Prozorske daske">Prozorske daske</option>
            </select>
          </label>
          <details className="inventory-collapsible">
            <summary>Dodaj novu stavku</summary>
            <div className="inventory-collapsible-content">
              <label className="compact-field">
                Length (mm)
                <input
                  className="compact-input"
                  type="number"
                  min={1}
                  required
                  placeholder="npr. 3000"
                  value={inventoryLengthMm}
                  onChange={(event) => setInventoryLengthMm(event.target.value)}
                />
              </label>
              <label className="compact-field">
                Qty
                <input
                  className="compact-input"
                  type="number"
                  min={1}
                  required
                  placeholder="npr. 5"
                  value={inventoryQty}
                  onChange={(event) => setInventoryQty(event.target.value)}
                />
              </label>
              <button type="submit" disabled={busy}>
                Dodaj
              </button>
            </div>
          </details>
        </form>
        <div className="inventory-table-wrap">
          <p className="inventory-table-title">Prikaz klase: {inventoryClass}</p>
          {filteredInventory.length === 0 ? (
            <p className="inventory-empty">Nema unosa za izabranu klasu.</p>
          ) : (
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Length (mm)</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.map((item) => (
                  <tr key={item.id}>
                    <td>{item.lengthMm}</td>
                    <td>{item.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Order Plan</h2>
        <form onSubmit={onPlan} className="grid">
          <label>
            Units
            <select value={units} onChange={(event) => setUnits(event.target.value as "mm" | "cm" | "m")}>
              <option value="mm">mm</option>
              <option value="cm">cm</option>
              <option value="m">m</option>
            </select>
          </label>
          <label>
            Kerf (mm)
            <input type="number" min={0} value={kerfMm} onChange={(event) => setKerfMm(event.target.value)} />
          </label>
          <label>
            Allowance (mm)
            <input
              type="number"
              min={0}
              value={allowanceMm}
              onChange={(event) => setAllowanceMm(event.target.value)}
            />
          </label>
          <label>
            Min remnant (mm)
            <input
              type="number"
              min={0}
              value={minRemnantMm}
              onChange={(event) => setMinRemnantMm(event.target.value)}
            />
          </label>
          <label className="textarea-row">
            Order lines JSON
            <textarea
              rows={8}
              value={orderLinesJson}
              onChange={(event) => setOrderLinesJson(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            Generiši plan
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Plan Result</h2>
        {planResponse ? (
          <>
            <p className="status">
              Status: <strong>{planResponse.status}</strong> | Plan ID: <code>{planResponse.planId}</code>
            </p>
            <button onClick={onCommit} disabled={busy}>
              Commit plan
            </button>
            <pre>{JSON.stringify(planResponse, null, 2)}</pre>
          </>
        ) : (
          <p>Pokreni planiranje da vidiš rezultat.</p>
        )}
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  );
}
