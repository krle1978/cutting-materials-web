'use client';

import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import cuttingMaterialBanner from "./cutting_material_banner.png";

type InventoryClass = "Komarnici" | "Prozorske daske";

type InventoryItem = {
  id: number;
  inventoryClass: InventoryClass;
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

type OrderTableRow = {
  id: number;
  inventoryClass: InventoryClass;
  heightMm: number | null;
  widthMm: number;
  qty: number;
  includeProzorskeDaske: boolean;
};

type PersistedOrder = {
  id: string;
  inventoryClass: InventoryClass;
  heightMm: number | null;
  widthMm: number;
  qty: number;
  widthOnly: boolean;
  derivedFromWidth: boolean;
  status: "PENDING" | "ACCEPTED";
  createdAt: string;
  acceptedAt: string | null;
  acceptedPlanIds: string[];
};

type ExecutedPlan = {
  label: string;
  plan: PlanResponse;
};

type MainTab = "InventoryOrders" | "OrderPlan";
type PanelTab = "Inventory" | "Orders";
type OrdersStatusFilter = "ALL" | "PENDING" | "ACCEPTED";
type OrdersClassFilter = "ALL" | InventoryClass;

export default function HomePage() {
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000", []);

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryLengthMm, setInventoryLengthMm] = useState("");
  const [inventoryQty, setInventoryQty] = useState("");

  const [units, setUnits] = useState<"mm" | "cm" | "m">("mm");
  const [orderClass, setOrderClass] = useState<InventoryClass>("Komarnici");
  const [orderHeight, setOrderHeight] = useState("");
  const [orderWidth, setOrderWidth] = useState("");
  const [orderQty, setOrderQty] = useState("1");
  const [includeProzorskeDaskeWidths, setIncludeProzorskeDaskeWidths] = useState(false);
  const [orderRows, setOrderRows] = useState<OrderTableRow[]>([]);

  const [orders, setOrders] = useState<PersistedOrder[]>([]);
  const [executedPlans, setExecutedPlans] = useState<ExecutedPlan[]>([]);
  const [mainTab, setMainTab] = useState<MainTab>("InventoryOrders");
  const [inventoryPanelTab, setInventoryPanelTab] = useState<PanelTab>("Inventory");
  const [ordersStatusFilter, setOrdersStatusFilter] = useState<OrdersStatusFilter>("ALL");
  const [ordersClassFilter, setOrdersClassFilter] = useState<OrdersClassFilter>("ALL");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rowIdRef = useRef(1);

  const inventoryByClass = useMemo(() => {
    const komarnici = inventory
      .filter((item) => item.inventoryClass === "Komarnici")
      .sort((a, b) => a.lengthMm - b.lengthMm);
    const prozorskeDaske = inventory
      .filter((item) => item.inventoryClass === "Prozorske daske")
      .sort((a, b) => a.lengthMm - b.lengthMm);
    return { komarnici, prozorskeDaske };
  }, [inventory]);

  const filteredOrders = useMemo(() => {
    return orders.filter((item) => {
      const statusMatch = ordersStatusFilter === "ALL" || item.status === ordersStatusFilter;
      const classMatch = ordersClassFilter === "ALL" || item.inventoryClass === ordersClassFilter;
      return statusMatch && classMatch;
    });
  }, [orders, ordersStatusFilter, ordersClassFilter]);

  const pendingOrdersCount = useMemo(() => {
    return filteredOrders.filter((item) => item.status === "PENDING").length;
  }, [filteredOrders]);

  const showOrdersHeightColumn = useMemo(() => {
    return filteredOrders.some((item) => item.inventoryClass === "Komarnici" || item.heightMm != null);
  }, [filteredOrders]);

  const showOrderRowsHeightColumn = useMemo(() => {
    return orderRows.some((item) => item.inventoryClass === "Komarnici" || item.heightMm != null);
  }, [orderRows]);

  const loadInventory = useCallback(async () => {
    const response = await fetch(`${apiUrl}/inventory`);
    if (!response.ok) {
      throw new Error(`Inventory fetch failed (${response.status})`);
    }
    const data = (await response.json()) as { items: InventoryItem[] };
    setInventory(data.items ?? []);
  }, [apiUrl]);

  const loadOrders = useCallback(async () => {
    const response = await fetch(`${apiUrl}/orders`);
    if (!response.ok) {
      throw new Error(`Orders fetch failed (${response.status})`);
    }
    const data = (await response.json()) as { items: PersistedOrder[] };
    setOrders(data.items ?? []);
  }, [apiUrl]);

  useEffect(() => {
    Promise.all([loadInventory(), loadOrders()]).catch((err: Error) => setError(err.message));
  }, [loadInventory, loadOrders]);

  useEffect(() => {
    if (orderClass !== "Komarnici") {
      setIncludeProzorskeDaskeWidths(false);
      setOrderHeight("");
    }
  }, [orderClass]);

  async function onAddInventory(inventoryClass: InventoryClass) {
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

  function onAddOrderRow() {
    const needsHeight = orderClass === "Komarnici";
    const parsedHeightMm = Number(orderHeight);
    const heightMm = needsHeight ? parsedHeightMm : null;
    const widthMm = Number(orderWidth);
    const qty = Number(orderQty);

    if (needsHeight && (!Number.isInteger(parsedHeightMm) || parsedHeightMm < 1)) {
      setError("Height mora biti ceo broj > 0.");
      return;
    }
    if (!Number.isInteger(widthMm) || widthMm < 1) {
      setError("Width mora biti ceo broj > 0.");
      return;
    }
    if (!Number.isInteger(qty) || qty < 1) {
      setError("Qty mora biti ceo broj > 0.");
      return;
    }

    const baseId = rowIdRef.current;
    rowIdRef.current += 1;

    const rowsToAdd: OrderTableRow[] = [
      {
        id: baseId,
        inventoryClass: orderClass,
        heightMm,
        widthMm,
        qty,
        includeProzorskeDaske: orderClass === "Komarnici" && includeProzorskeDaskeWidths
      }
    ];

    setOrderRows((prev) => [...prev, ...rowsToAdd]);
    setError(null);
    setOrderHeight("");
    setOrderWidth("");
    setOrderQty("1");
  }

  function onRemoveOrderRow(row: OrderTableRow) {
    setOrderRows((prev) => prev.filter((entry) => entry.id !== row.id));
  }

  async function onOrderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (orderRows.length === 0) {
      setError("Tabela porudzbina je prazna.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          units,
          rows: orderRows.flatMap((row) => {
            const baseRow = {
              inventoryClass: row.inventoryClass,
              height: row.heightMm,
              width: row.widthMm,
              qty: row.qty,
              widthOnly: false,
              derivedFromWidth: false
            };

            if (row.inventoryClass === "Komarnici" && row.includeProzorskeDaske) {
              return [
                baseRow,
                {
                  inventoryClass: "Prozorske daske" as const,
                  height: null,
                  width: row.widthMm,
                  qty: row.qty,
                  widthOnly: true,
                  derivedFromWidth: true
                }
              ];
            }

            return [baseRow];
          })
        })
      });

      const data = (await response.json()) as { error?: string; items?: PersistedOrder[] };
      if (!response.ok) {
        throw new Error(data.error ?? `Order save failed (${response.status})`);
      }

      setOrders(data.items ?? []);
      setOrderRows([]);
      setInventoryPanelTab("Orders");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function onAcceptOrder(orderId: string) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/orders/${orderId}/accept`, {
        method: "POST"
      });

      const data = (await response.json()) as {
        error?: string;
        items?: PersistedOrder[];
        inventory?: InventoryItem[];
        plan?: PlanResponse;
      };

      if (!response.ok) {
        throw new Error(data.error ?? `Order accept failed (${response.status})`);
      }

      setOrders(data.items ?? []);
      if (data.inventory) {
        setInventory(data.inventory);
      }
      if (data.plan) {
        const acceptedPlan = data.plan;
        setExecutedPlans((prev) => [
          {
            label: `Order ${orderId}`,
            plan: acceptedPlan
          },
          ...prev
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function onAcceptAll() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/orders/accept-all`, {
        method: "POST"
      });

      const data = (await response.json()) as {
        error?: string;
        items?: PersistedOrder[];
        inventory?: InventoryItem[];
        results?: Array<{
          orderId: string;
          status: "ACCEPTED" | "ALREADY_ACCEPTED" | "FAILED";
          error?: string;
          plan?: PlanResponse;
        }>;
      };

      if (!response.ok) {
        throw new Error(data.error ?? `Accept All failed (${response.status})`);
      }

      setOrders(data.items ?? []);
      if (data.inventory) {
        setInventory(data.inventory);
      }

      const acceptedPlans: ExecutedPlan[] = [];
      for (const item of data.results ?? []) {
        if (!item.plan) {
          continue;
        }
        acceptedPlans.push({
          label: `Order ${item.orderId}`,
          plan: item.plan
        });
      }

      if (acceptedPlans.length > 0) {
        setExecutedPlans((prev) => [...acceptedPlans, ...prev]);
      }

      const failed = (data.results ?? []).filter((item) => item.status === "FAILED");
      if (failed.length > 0) {
        setError(`Neke porudzbine nisu prihvacene: ${failed.map((item) => item.orderId).join(", ")}`);
      }
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
        <div className="hero-content">
          <Image
            src={cuttingMaterialBanner}
            alt="Cutting Materials"
            className="hero-banner"
            priority
          />
          <p className="sub">
            Aplikacija sluzi za optimizaciju secenja komarnika i prozorskih daski na osnovu stanja lagera,
            kako bi se smanjio otpad materijala i ubrzala izrada naloga.
          </p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-tabs" role="group" aria-label="Main tabs">
          <button
            type="button"
            aria-pressed={mainTab === "InventoryOrders"}
            className={`panel-tab ${mainTab === "InventoryOrders" ? "active" : ""}`}
            onClick={() => setMainTab("InventoryOrders")}
          >
            Inventory / Orders
          </button>
          <button
            type="button"
            aria-pressed={mainTab === "OrderPlan"}
            className={`panel-tab ${mainTab === "OrderPlan" ? "active" : ""}`}
            onClick={() => setMainTab("OrderPlan")}
          >
            Order Plan
          </button>
        </div>
      </section>

      {mainTab === "InventoryOrders" && (
      <section className="panel">
        <h2>Inventory / Orders</h2>
        <div className="panel-tabs" role="group" aria-label="Inventory and orders tabs">
          <button
            type="button"
            className={`panel-tab ${inventoryPanelTab === "Inventory" ? "active" : ""}`}
            onClick={() => setInventoryPanelTab("Inventory")}
          >
            Inventory
          </button>
          <button
            type="button"
            className={`panel-tab ${inventoryPanelTab === "Orders" ? "active" : ""}`}
            onClick={() => setInventoryPanelTab("Orders")}
          >
            Orders
          </button>
        </div>

        {inventoryPanelTab === "Inventory" ? (
          <div>
            <div className="grid">
              <details className="inventory-collapsible">
                <summary>Dodaj novu stavku</summary>
                <div className="inventory-collapsible-content">
                  <label className="short-field">
                    Length (mm)
                    <input
                      className="short-input"
                      type="number"
                      min={1}
                      required
                      placeholder="npr. 3000"
                      value={inventoryLengthMm}
                      onChange={(event) => setInventoryLengthMm(event.target.value)}
                    />
                  </label>
                  <label className="short-field">
                    Qty
                    <input
                      className="short-input"
                      type="number"
                      min={1}
                      required
                      placeholder="npr. 5"
                      value={inventoryQty}
                      onChange={(event) => setInventoryQty(event.target.value)}
                    />
                  </label>
                  <div className="inventory-action-row">
                    <button type="button" disabled={busy} onClick={() => onAddInventory("Komarnici")}>
                      Dodaj Komarnici
                    </button>
                    <button type="button" disabled={busy} onClick={() => onAddInventory("Prozorske daske")}>
                      Dodaj Prozorske daske
                    </button>
                  </div>
                </div>
              </details>
            </div>
            <div className="inventory-table-wrap">
              <p className="inventory-table-title">Komarnici</p>
              {inventoryByClass.komarnici.length === 0 ? (
                <p className="inventory-empty">Nema unosa za klasu Komarnici.</p>
              ) : (
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th>Length (mm)</th>
                      <th>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventoryByClass.komarnici.map((item) => (
                      <tr key={item.id}>
                        <td>{item.lengthMm}</td>
                        <td>{item.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="inventory-table-wrap">
              <p className="inventory-table-title">Prozorske daske</p>
              {inventoryByClass.prozorskeDaske.length === 0 ? (
                <p className="inventory-empty">Nema unosa za klasu Prozorske daske.</p>
              ) : (
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th>Length (mm)</th>
                      <th>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventoryByClass.prozorskeDaske.map((item) => (
                      <tr key={item.id}>
                        <td>{item.lengthMm}</td>
                        <td>{item.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          <div className="orders-history">
            <div className="order-submit-wrap">
              <button type="button" disabled={busy || pendingOrdersCount === 0} onClick={onAcceptAll}>
                Accept All
              </button>
            </div>
            <div className="orders-filters">
              <label className="short-field">
                Status
                <select
                  className="short-input"
                  value={ordersStatusFilter}
                  onChange={(event) => setOrdersStatusFilter(event.target.value as OrdersStatusFilter)}
                >
                  <option value="ALL">Sve</option>
                  <option value="PENDING">Pending</option>
                  <option value="ACCEPTED">Accepted</option>
                </select>
              </label>
              <label className="short-field">
                Klasa
                <select
                  className="short-input"
                  value={ordersClassFilter}
                  onChange={(event) => setOrdersClassFilter(event.target.value as OrdersClassFilter)}
                >
                  <option value="ALL">Sve</option>
                  <option value="Komarnici">Komarnici</option>
                  <option value="Prozorske daske">Prozorske daske</option>
                </select>
              </label>
            </div>
            {filteredOrders.length === 0 ? (
              <p className="inventory-empty">Nema kreiranih porudzbina.</p>
            ) : (
              <div className="inventory-table-wrap">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th>Klasa</th>
                      {showOrdersHeightColumn && <th>Height</th>}
                      <th>Width</th>
                      <th>Qty</th>
                      <th>Akcija</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((order) => (
                      <tr key={order.id}>
                        <td>{order.inventoryClass}</td>
                        {showOrdersHeightColumn && <td>{order.heightMm ?? "-"}</td>}
                        <td>{order.widthMm}</td>
                        <td>{order.qty}</td>
                        <td>
                          {order.status === "PENDING" ? (
                            <button type="button" disabled={busy} onClick={() => onAcceptOrder(order.id)}>
                              Accept
                            </button>
                          ) : (
                            <span>Accepted</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
      )}

      {mainTab === "OrderPlan" && (
      <section className="panel">
        <h2>Order Plan</h2>
        <form onSubmit={onOrderSubmit} className="grid order-grid">
          <label className="short-field">
            Klasa
            <select
              className="short-input"
              value={orderClass}
              onChange={(event) => setOrderClass(event.target.value as InventoryClass)}
            >
              <option value="Komarnici">Komarnici</option>
              <option value="Prozorske daske">Prozorske daske</option>
            </select>
          </label>
          <label className="short-field">
            Units
            <select
              className="short-input"
              value={units}
              onChange={(event) => setUnits(event.target.value as "mm" | "cm" | "m")}
            >
              <option value="mm">mm</option>
              <option value="cm">cm</option>
              <option value="m">m</option>
            </select>
          </label>
          {orderClass === "Komarnici" && (
            <label className="short-field">
              Height
              <input
                className="short-input"
                type="number"
                min={1}
                value={orderHeight}
                onChange={(event) => setOrderHeight(event.target.value)}
              />
            </label>
          )}
          <label className="short-field">
            Width
            <input
              className="short-input"
              type="number"
              min={1}
              value={orderWidth}
              onChange={(event) => setOrderWidth(event.target.value)}
            />
          </label>
          <label className="short-field">
            Qty
            <input
              className="short-input"
              type="number"
              min={1}
              value={orderQty}
              onChange={(event) => setOrderQty(event.target.value)}
            />
          </label>

          {orderClass === "Komarnici" && (
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={includeProzorskeDaskeWidths}
                onChange={(event) => setIncludeProzorskeDaskeWidths(event.target.checked)}
              />
              Prozorske Daske
            </label>
          )}

          <div className="order-actions">
            <button type="button" disabled={busy} onClick={onAddOrderRow}>
              Enter into table
            </button>
          </div>

          <div className="order-table-wrap">
            <p className="inventory-table-title">Tabela porudzbina</p>
            {orderRows.length === 0 ? (
              <p className="inventory-empty">Nema unosa u tabeli.</p>
            ) : (
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th>Klasa</th>
                    {showOrderRowsHeightColumn && <th>Height</th>}
                    <th>Width</th>
                    <th>Qty</th>
                    <th className="pdaske-col">P. Daske</th>
                    <th>Akcija</th>
                  </tr>
                </thead>
                <tbody>
                  {orderRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.inventoryClass}</td>
                      {showOrderRowsHeightColumn && <td>{row.heightMm ?? "-"}</td>}
                      <td>{row.widthMm}</td>
                      <td>{row.qty}</td>
                      <td className="pdaske-col">
                        {row.inventoryClass === "Komarnici" ? (
                          <input
                            className="pdaske-check"
                            type="checkbox"
                            checked={row.includeProzorskeDaske}
                            disabled
                            aria-label={`P. Daske za red ${row.id}`}
                          />
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        <button type="button" onClick={() => onRemoveOrderRow(row)}>
                          Obrisi
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="order-submit-wrap">
              <button type="submit" disabled={busy || orderRows.length === 0}>
                Order
              </button>
            </div>
          </div>
        </form>
      </section>
      )}

      <section className="panel">
        <h2>Plan Result</h2>
        {executedPlans.length > 0 ? (
          executedPlans.map((entry) => (
            <div key={entry.plan.planId} className="result-item">
              <p className="status">
                {entry.label}: <strong>{entry.plan.status}</strong> | Plan ID: <code>{entry.plan.planId}</code>
              </p>
              <pre>{JSON.stringify(entry.plan, null, 2)}</pre>
            </div>
          ))
        ) : (
          <p>Prihvati porudzbinu da vidis rezultat krojenja.</p>
        )}
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  );
}
