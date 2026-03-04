'use client';

import Link from "next/link";
import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACCOUNTS_STORAGE_KEY,
  CURRENT_ACCOUNT_STORAGE_KEY,
  NOTIFICATIONS_STORAGE_KEY,
  type AccountRole,
  type UserAccount,
  isUserAccount,
  normalizeIdentity,
  resolveCurrentAccount
} from "./lib/account-store";
import { resolveApiBaseUrl } from "./lib/api";
import {
  getInstallationStartDateText,
  isWorkerJobRequest,
  normalizeWorkerJobRequest,
  type WorkerJobRequest,
  WORKER_JOB_REQUESTS_STORAGE_KEY
} from "./lib/worker-job-store";
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
  needsWorker: boolean;
};

type PersistedOrder = {
  id: string;
  inventoryClass: InventoryClass;
  heightMm: number | null;
  widthMm: number;
  qty: number;
  widthOnly: boolean;
  derivedFromWidth: boolean;
  createdByUsername: string;
  createdByEmail: string;
  createdByRole: AccountRole;
  needsWorker: boolean;
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
type AuthMode = "LOGIN" | "SIGNUP";
type SignupRole = "Worker" | "Customer";

type UserNotification = {
  id: string;
  recipientUsername: string;
  recipientEmail: string;
  orderId: string;
  message: string;
  createdAt: string;
  readAt: string | null;
};

function isUserNotification(value: unknown): value is UserNotification {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<UserNotification>;
  const isReadAtValid =
    candidate.readAt === null || candidate.readAt === undefined || typeof candidate.readAt === "string";
  return (
    typeof candidate.id === "string" &&
    typeof candidate.recipientUsername === "string" &&
    typeof candidate.recipientEmail === "string" &&
    typeof candidate.orderId === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.createdAt === "string" &&
    isReadAtValid
  );
}

function normalizeNotification(notification: UserNotification): UserNotification {
  return {
    ...notification,
    readAt: typeof notification.readAt === "string" && notification.readAt.length > 0 ? notification.readAt : null
  };
}

function toDateOrderValue(iso: string): number {
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? 0 : value;
}

function formatOrderForMessage(order: PersistedOrder): string {
  return `Klasa: ${order.inventoryClass}, Height: ${order.heightMm ?? "-"}, Width: ${order.widthMm}, Qty: ${order.qty}`;
}

function getPickupDateText(acceptedAt: Date): string {
  const pickupDate = new Date(acceptedAt);
  pickupDate.setDate(pickupDate.getDate() + 2);
  return new Intl.DateTimeFormat("sr-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(pickupDate);
}

function buildAcceptedOrderMessage(order: PersistedOrder, acceptedAt: Date): string {
  return `Va\u0161a potud\u017ebina\n${formatOrderForMessage(order)}\nje potvr\u0111ena.\nMo\u017eete je pokupiti od ${getPickupDateText(acceptedAt)}`;
}

function buildWorkerRequestMessage(request: WorkerJobRequest): string {
  return `Kupac: ${request.customerUsername}\nKlasa: ${request.inventoryClass}\nHeight: ${request.heightMm ?? "-"}\nWidth: ${request.widthMm}\nQty: ${request.qty}`;
}

function resolveAcceptedAtDate(order: PersistedOrder): Date {
  const candidate = order.acceptedAt ?? order.createdAt;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

export default function HomePage() {
  const apiUrl = useMemo(resolveApiBaseUrl, []);
  const apiConfigError =
    "API nije konfigurisan. Postavi NEXT_PUBLIC_API_URL na frontend deploy-u (Vercel).";

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
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [currentAccount, setCurrentAccount] = useState<UserAccount | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("LOGIN");
  const [loginIdentity, setLoginIdentity] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupRole, setSignupRole] = useState<SignupRole>("Worker");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [workerJobRequests, setWorkerJobRequests] = useState<WorkerJobRequest[]>([]);
  const [showNotificationHistory, setShowNotificationHistory] = useState(false);
  const [refreshingMessages, setRefreshingMessages] = useState(false);
  const [needsWorkerForOrder, setNeedsWorkerForOrder] = useState(false);
  const [workerPickerOrderId, setWorkerPickerOrderId] = useState<string | null>(null);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);

  const rowIdRef = useRef(1);
  const needsWorkerForOrderRef = useRef(false);
  const currentRole = currentAccount?.role ?? null;
  const canViewInventoryOrders = currentRole === "Owner" || currentRole === "Lager";
  const canViewOrderPlan =
    currentRole === "Owner" || currentRole === "Worker" || currentRole === "Customer";
  const canAccessSettings = currentRole === "Owner";
  const workerAccounts = useMemo(() => {
    return accounts
      .filter((account) => account.role === "Worker")
      .sort((left, right) => left.username.localeCompare(right.username));
  }, [accounts]);
  const accountNotifications = useMemo(() => {
    if (!currentAccount) {
      return [];
    }
    const username = normalizeIdentity(currentAccount.username);
    const email = normalizeIdentity(currentAccount.email);
    return notifications
      .filter(
        (item) =>
          normalizeIdentity(item.recipientUsername) === username ||
          normalizeIdentity(item.recipientEmail) === email
      )
      .sort((a, b) => toDateOrderValue(b.createdAt) - toDateOrderValue(a.createdAt));
  }, [currentAccount, notifications]);
  const unreadNotifications = useMemo(() => {
    return accountNotifications.filter((item) => item.readAt == null);
  }, [accountNotifications]);
  const notificationHistory = useMemo(() => {
    return [...accountNotifications].sort((a, b) => toDateOrderValue(a.createdAt) - toDateOrderValue(b.createdAt));
  }, [accountNotifications]);
  const workerJobRequestByOrderId = useMemo(() => {
    return new Map(workerJobRequests.map((request) => [request.orderId, request]));
  }, [workerJobRequests]);
  const activeWorkerJobs = useMemo(() => {
    if (!currentAccount || currentRole !== "Worker") {
      return [];
    }

    return workerJobRequests
      .filter((request) => {
        const currentAssignment = request.assignments.find(
          (assignment) => assignment.workerAccountId === currentAccount.id
        );
        if (!currentAssignment) {
          return false;
        }
        if (request.acceptedWorkerAccountId) {
          return request.acceptedWorkerAccountId === currentAccount.id;
        }
        return currentAssignment.status === "PENDING";
      })
      .sort((left, right) => toDateOrderValue(right.requestedAt) - toDateOrderValue(left.requestedAt));
  }, [currentAccount, currentRole, workerJobRequests]);
  const workerPickerOrder = useMemo(() => {
    if (!workerPickerOrderId) {
      return null;
    }
    return orders.find((order) => order.id === workerPickerOrderId) ?? null;
  }, [orders, workerPickerOrderId]);

  const fetchApi = useCallback(
    (path: string, init?: RequestInit) => {
      if (!apiUrl) {
        throw new Error(apiConfigError);
      }
      return fetch(`${apiUrl}${path}`, init);
    },
    [apiConfigError, apiUrl]
  );

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
    const response = await fetchApi("/inventory");
    if (!response.ok) {
      throw new Error(`Inventory fetch failed (${response.status})`);
    }
    const data = (await response.json()) as { items: InventoryItem[] };
    setInventory(data.items ?? []);
  }, [fetchApi]);

  const loadOrders = useCallback(async () => {
    const response = await fetchApi("/orders");
    if (!response.ok) {
      throw new Error(`Orders fetch failed (${response.status})`);
    }
    const data = (await response.json()) as { items: PersistedOrder[] };
    setOrders(data.items ?? []);
  }, [fetchApi]);

  const loadAccounts = useCallback(async () => {
    const response = await fetchApi("/accounts");
    if (!response.ok) {
      throw new Error(`Accounts fetch failed (${response.status})`);
    }
    const data = (await response.json()) as { items?: UserAccount[] };
    const items = Array.isArray(data.items) ? data.items.filter(isUserAccount) : [];
    setAccounts(items);
    if (typeof window !== "undefined") {
      const storedCurrentAccountId = window.localStorage.getItem(CURRENT_ACCOUNT_STORAGE_KEY);
      setCurrentAccount(resolveCurrentAccount(storedCurrentAccountId, items));
      window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(items));
    }
  }, [fetchApi]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const restoreCachedAccounts = () => {
      const raw = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const storedAccounts = Array.isArray(parsed) ? parsed.filter(isUserAccount) : [];
      const storedCurrentAccountId = window.localStorage.getItem(CURRENT_ACCOUNT_STORAGE_KEY);
      setAccounts(storedAccounts);
      setCurrentAccount(resolveCurrentAccount(storedCurrentAccountId, storedAccounts));
    };

    try {
      const rawNotifications = window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
      const parsedNotifications = rawNotifications ? (JSON.parse(rawNotifications) as unknown) : [];
      const storedNotifications = Array.isArray(parsedNotifications)
        ? parsedNotifications.filter(isUserNotification).map(normalizeNotification)
        : [];
      setNotifications(storedNotifications);

      const rawWorkerRequests = window.localStorage.getItem(WORKER_JOB_REQUESTS_STORAGE_KEY);
      const parsedWorkerRequests = rawWorkerRequests ? (JSON.parse(rawWorkerRequests) as unknown) : [];
      const storedWorkerRequests = Array.isArray(parsedWorkerRequests)
        ? parsedWorkerRequests.filter(isWorkerJobRequest).map(normalizeWorkerJobRequest)
        : [];
      setWorkerJobRequests(storedWorkerRequests);
    } catch {
      restoreCachedAccounts();
      setNotifications([]);
      window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify([]));
      setWorkerJobRequests([]);
      window.localStorage.setItem(WORKER_JOB_REQUESTS_STORAGE_KEY, JSON.stringify([]));
    }

    loadAccounts()
      .catch(() => {
        restoreCachedAccounts();
      })
      .finally(() => {
        setAuthReady(true);
      });
  }, [loadAccounts]);

  useEffect(() => {
    if (!authReady || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
  }, [accounts, authReady]);

  useEffect(() => {
    if (!authReady || typeof window === "undefined") {
      return;
    }

    if (!currentAccount) {
      window.localStorage.removeItem(CURRENT_ACCOUNT_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(CURRENT_ACCOUNT_STORAGE_KEY, currentAccount.id);
  }, [authReady, currentAccount]);

  useEffect(() => {
    if (!authReady || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
  }, [authReady, notifications]);

  useEffect(() => {
    if (!authReady || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(WORKER_JOB_REQUESTS_STORAGE_KEY, JSON.stringify(workerJobRequests));
  }, [authReady, workerJobRequests]);

  useEffect(() => {
    if (!currentRole) {
      return;
    }

    if (canViewInventoryOrders) {
      Promise.all([loadInventory(), loadOrders()]).catch((err: Error) => setError(err.message));
      return;
    }

    setInventory([]);
    setOrders([]);
  }, [canViewInventoryOrders, currentRole, loadInventory, loadOrders]);

  useEffect(() => {
    if (!currentRole || !canViewInventoryOrders || typeof window === "undefined") {
      return;
    }

    let cancelled = false;
    const refresh = () => {
      Promise.all([loadInventory(), loadOrders()]).catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      });
    };

    const onWindowFocus = () => {
      refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    const intervalId = window.setInterval(refresh, 8000);
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [canViewInventoryOrders, currentRole, loadInventory, loadOrders]);

  useEffect(() => {
    if (!currentAccount || apiUrl) {
      return;
    }
    setError(apiConfigError);
  }, [apiConfigError, apiUrl, currentAccount]);

  useEffect(() => {
    if (!currentRole) {
      return;
    }

    if (!canViewInventoryOrders && !canViewOrderPlan) {
      return;
    }

    if (!canViewInventoryOrders && mainTab !== "OrderPlan") {
      setMainTab("OrderPlan");
      return;
    }

    if (!canViewOrderPlan && mainTab !== "InventoryOrders") {
      setMainTab("InventoryOrders");
    }
  }, [canViewInventoryOrders, canViewOrderPlan, currentRole, mainTab]);

  useEffect(() => {
    if (orderClass !== "Komarnici") {
      setIncludeProzorskeDaskeWidths(false);
      setOrderHeight("");
    }
  }, [orderClass]);

  useEffect(() => {
    if (currentRole !== "Customer") {
      setNeedsWorkerForOrder(false);
    }
  }, [currentRole]);

  useEffect(() => {
    if (!canViewInventoryOrders) {
      return;
    }

    setInventoryPanelTab(getDefaultInventoryPanelTab(currentRole));
  }, [canViewInventoryOrders, currentRole]);

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
      const response = await fetchApi("/inventory/add", {
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
        includeProzorskeDaske: orderClass === "Komarnici" && includeProzorskeDaskeWidths,
        needsWorker: currentRole === "Customer" && needsWorkerForOrder
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

  function resetOrderPlanDraft() {
    setUnits("mm");
    setOrderClass("Komarnici");
    setOrderHeight("");
    setOrderWidth("");
    setOrderQty("1");
    setIncludeProzorskeDaskeWidths(false);
    setNeedsWorkerForOrder(false);
    needsWorkerForOrderRef.current = false;
    setOrderRows([]);
    setError(null);
  }

  function onCustomerNeedsWorkerChange(checked: boolean) {
    needsWorkerForOrderRef.current = checked;
    setNeedsWorkerForOrder(checked);
    setOrderRows((prev) => prev.map((row) => ({ ...row, needsWorker: checked })));
  }

  function getDefaultInventoryPanelTab(role: AccountRole | null): PanelTab {
    return role === "Owner" || role === "Lager" ? "Orders" : "Inventory";
  }

  function reloadPage() {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  function createWorkerAssignments(targetWorkers: UserAccount[]) {
    return targetWorkers.map((worker) => ({
      workerAccountId: worker.id,
      workerUsername: worker.username,
      workerEmail: worker.email,
      status: "PENDING" as const,
      respondedAt: null
    }));
  }

  function upsertWorkerRequest(
    existingRequests: WorkerJobRequest[],
    order: PersistedOrder,
    targetWorkers: UserAccount[],
    orderAcceptedAt: string | null
  ): WorkerJobRequest[] {
    if (targetWorkers.length === 0) {
      return existingRequests;
    }

    const existing = existingRequests.find((request) => request.orderId === order.id);
    const nextRequest: WorkerJobRequest = {
      id: existing?.id ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `job-${order.id}`),
      orderId: order.id,
      inventoryClass: order.inventoryClass,
      heightMm: order.heightMm,
      widthMm: order.widthMm,
      qty: order.qty,
      customerUsername: order.createdByUsername,
      customerEmail: order.createdByEmail,
      requestedAt: existing?.requestedAt ?? new Date().toISOString(),
      orderAcceptedAt: orderAcceptedAt ?? existing?.orderAcceptedAt ?? null,
      acceptedWorkerAccountId: existing?.acceptedWorkerAccountId ?? null,
      acceptedWorkerUsername: existing?.acceptedWorkerUsername ?? null,
      assignments:
        existing?.acceptedWorkerAccountId != null
          ? existing.assignments
          : createWorkerAssignments(targetWorkers)
    };

    if (!existing) {
      return [nextRequest, ...existingRequests];
    }

    return existingRequests.map((request) => (request.orderId === order.id ? nextRequest : request));
  }

  function ensureWorkerRequestsForAcceptedOrders(
    existingRequests: WorkerJobRequest[],
    acceptedOrders: PersistedOrder[]
  ): WorkerJobRequest[] {
    let nextRequests = existingRequests;

    for (const order of acceptedOrders) {
      if (order.createdByRole !== "Customer" || !order.needsWorker) {
        continue;
      }

      const existing = nextRequests.find((request) => request.orderId === order.id);
      const targetWorkerIds =
        existing?.assignments.map((assignment) => assignment.workerAccountId) ??
        workerAccounts.map((worker) => worker.id);
      const targetWorkers = workerAccounts.filter((worker) => targetWorkerIds.includes(worker.id));
      nextRequests = upsertWorkerRequest(nextRequests, order, targetWorkers, order.acceptedAt);
    }

    return nextRequests;
  }

  function openWorkerPicker(order: PersistedOrder) {
    const existing = workerJobRequestByOrderId.get(order.id);
    setWorkerPickerOrderId(order.id);
    setSelectedWorkerIds(existing?.assignments.map((assignment) => assignment.workerAccountId) ?? []);
  }

  function closeWorkerPicker() {
    setWorkerPickerOrderId(null);
    setSelectedWorkerIds([]);
  }

  function onToggleWorkerForRequest(workerId: string) {
    setSelectedWorkerIds((prev) =>
      prev.includes(workerId) ? prev.filter((currentId) => currentId !== workerId) : [...prev, workerId]
    );
  }

  function onSendWorkerRequest() {
    if (!workerPickerOrder) {
      return;
    }

    const targetWorkers = workerAccounts.filter((worker) => selectedWorkerIds.includes(worker.id));
    if (targetWorkers.length === 0) {
      setError("Izaberi bar jednog Workera.");
      return;
    }

    setWorkerJobRequests((prev) =>
      upsertWorkerRequest(prev, workerPickerOrder, targetWorkers, workerPickerOrder.acceptedAt)
    );
    setError(null);
    closeWorkerPicker();
  }

  function onWorkerAcceptJob(requestId: string) {
    if (!currentAccount || currentRole !== "Worker") {
      return;
    }

    const respondedAt = new Date().toISOString();
    setWorkerJobRequests((prev) =>
      prev.map((request) => {
        if (request.id !== requestId || request.acceptedWorkerAccountId) {
          return request;
        }

        return {
          ...request,
          acceptedWorkerAccountId: currentAccount.id,
          acceptedWorkerUsername: currentAccount.username,
          assignments: request.assignments.map((assignment) =>
            assignment.workerAccountId === currentAccount.id
              ? {
                  ...assignment,
                  status: "ACCEPTED",
                  respondedAt
                }
              : assignment
          )
        };
      })
    );
  }

  function onWorkerRejectJob(requestId: string) {
    if (!currentAccount || currentRole !== "Worker") {
      return;
    }

    const respondedAt = new Date().toISOString();
    setWorkerJobRequests((prev) =>
      prev.map((request) => {
        if (request.id !== requestId || request.acceptedWorkerAccountId) {
          return request;
        }

        return {
          ...request,
          assignments: request.assignments.map((assignment) =>
            assignment.workerAccountId === currentAccount.id
              ? {
                  ...assignment,
                  status: "REJECTED",
                  respondedAt
                }
              : assignment
          )
        };
      })
    );
  }

  function pushOrderAcceptedNotification(order: PersistedOrder, acceptedAt: Date) {
    const notification: UserNotification = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `note-${Date.now()}`,
      recipientUsername: order.createdByUsername,
      recipientEmail: order.createdByEmail,
      orderId: order.id,
      message: buildAcceptedOrderMessage(order, acceptedAt),
      createdAt: new Date().toISOString(),
      readAt: null
    };

    setNotifications((prev) => [notification, ...prev]);
  }

  function onMarkNotificationAsRead(notificationId: string) {
    const readAt = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((item) => (item.id === notificationId && item.readAt == null ? { ...item, readAt } : item))
    );
  }

  async function onRefreshWorkerMessages() {
    if (!currentAccount) {
      return;
    }

    setRefreshingMessages(true);
    setError(null);

    try {
      const response = await fetchApi("/orders");
      if (!response.ok) {
        throw new Error(`Orders fetch failed (${response.status})`);
      }

      const data = (await response.json()) as { items?: PersistedOrder[] };
      const backendOrders = data.items ?? [];
      const accountUsername = normalizeIdentity(currentAccount.username);
      const accountEmail = normalizeIdentity(currentAccount.email);

      setNotifications((prev) => {
        const existingByOrderId = new Set(
          prev
            .filter(
              (item) =>
                normalizeIdentity(item.recipientUsername) === accountUsername ||
                normalizeIdentity(item.recipientEmail) === accountEmail
            )
            .map((item) => item.orderId)
        );

        const additions: UserNotification[] = [];
        for (const order of backendOrders) {
          if (order.status !== "ACCEPTED") {
            continue;
          }

          const belongsToCurrentAccount =
            normalizeIdentity(order.createdByUsername) === accountUsername ||
            normalizeIdentity(order.createdByEmail) === accountEmail;
          if (!belongsToCurrentAccount || existingByOrderId.has(order.id)) {
            continue;
          }

          additions.push({
            id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `note-${order.id}-${Date.now()}`,
            recipientUsername: order.createdByUsername,
            recipientEmail: order.createdByEmail,
            orderId: order.id,
            message: buildAcceptedOrderMessage(order, resolveAcceptedAtDate(order)),
            createdAt: order.acceptedAt ?? order.createdAt,
            readAt: null
          });
        }

        if (additions.length === 0) {
          return prev;
        }

        return [
          ...additions.sort((a, b) => toDateOrderValue(b.createdAt) - toDateOrderValue(a.createdAt)),
          ...prev
        ];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setRefreshingMessages(false);
    }
  }

  async function onOrderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentAccount) {
      setError("Nisi ulogovan.");
      return;
    }

    if (orderRows.length === 0) {
      setError("Tabela porudzbina je prazna.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const effectiveNeedsWorker =
        currentAccount.role === "Customer" &&
        (needsWorkerForOrderRef.current || orderRows.some((row) => row.needsWorker));

      const response = await fetchApi("/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          units,
          createdBy: {
            username: currentAccount.username,
            email: currentAccount.email,
            role: currentAccount.role
          },
          needsWorker: effectiveNeedsWorker,
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
      setNeedsWorkerForOrder(false);
      setInventoryPanelTab("Orders");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function onAcceptOrder(orderId: string) {
    const acceptedAt = new Date();
    setBusy(true);
    setError(null);

    try {
      const response = await fetchApi(`/orders/${orderId}/accept`, {
        method: "POST"
      });

      const data = (await response.json()) as {
        error?: string;
        status?: "ACCEPTED" | "ALREADY_ACCEPTED";
        order?: PersistedOrder;
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
      if (data.status === "ACCEPTED" && data.order) {
        pushOrderAcceptedNotification(data.order, acceptedAt);
        setWorkerJobRequests((prev) => ensureWorkerRequestsForAcceptedOrders(prev, [data.order!]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function onAcceptAll() {
    const acceptedAt = new Date();
    setBusy(true);
    setError(null);

    try {
      const response = await fetchApi("/orders/accept-all", {
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
          order?: PersistedOrder;
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
          if (item.status === "ACCEPTED" && item.order) {
            pushOrderAcceptedNotification(item.order, acceptedAt);
          }
          continue;
        }
        acceptedPlans.push({
          label: `Order ${item.orderId}`,
          plan: item.plan
        });
        if (item.status === "ACCEPTED" && item.order) {
          pushOrderAcceptedNotification(item.order, acceptedAt);
        }
      }

      const acceptedOrders = (data.results ?? [])
        .filter((item): item is { orderId: string; status: "ACCEPTED"; order: PersistedOrder; plan?: PlanResponse } =>
          item.status === "ACCEPTED" && item.order != null
        )
        .map((item) => item.order);
      if (acceptedOrders.length > 0) {
        setWorkerJobRequests((prev) => ensureWorkerRequestsForAcceptedOrders(prev, acceptedOrders));
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

  function onLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const identity = normalizeIdentity(loginIdentity);

    if (!identity || !loginPassword) {
      setAuthError("Unesi username/email i password.");
      return;
    }

    const account = accounts.find((item) => {
      return normalizeIdentity(item.username) === identity || normalizeIdentity(item.email) === identity;
    });

    if (!account || account.password !== loginPassword) {
      setAuthError("Pogresni podaci za login.");
      return;
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem(CURRENT_ACCOUNT_STORAGE_KEY, account.id);
    }
    setCurrentAccount(account);
    resetOrderPlanDraft();
    setMainTab(account.role === "Owner" || account.role === "Lager" ? "InventoryOrders" : "OrderPlan");
    setInventoryPanelTab(getDefaultInventoryPanelTab(account.role));
    setAuthError(null);
    setAuthInfo(null);
    setLoginIdentity("");
    setLoginPassword("");
    reloadPage();
  }

  async function onSignupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = signupUsername.trim();
    const email = signupEmail.trim();
    const password = signupPassword.trim();
    const normalizedUsername = normalizeIdentity(username);
    const normalizedEmail = normalizeIdentity(email);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!username || !email || !password) {
      setAuthError("Sva polja su obavezna.");
      return;
    }

    if (!emailRegex.test(email)) {
      setAuthError("Email nije validan.");
      return;
    }

    if (password.length < 4) {
      setAuthError("Password mora imati bar 4 karaktera.");
      return;
    }

    const alreadyExists = accounts.some(
      (item) =>
        normalizeIdentity(item.username) === normalizedUsername || normalizeIdentity(item.email) === normalizedEmail
    );

    if (alreadyExists) {
      setAuthError("Username ili email vec postoji.");
      return;
    }

    setBusy(true);
    setAuthError(null);

    try {
      const response = await fetchApi("/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email,
          password,
          role: signupRole
        })
      });

      const data = (await response.json()) as { error?: string; account?: UserAccount; items?: UserAccount[] };
      if (!response.ok || !data.account) {
        throw new Error(data.error ?? `Account create failed (${response.status})`);
      }

      const nextAccounts = Array.isArray(data.items) ? data.items.filter(isUserAccount) : [...accounts, data.account];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(nextAccounts));
        window.localStorage.setItem(CURRENT_ACCOUNT_STORAGE_KEY, data.account.id);
      }
      setAccounts(nextAccounts);
      setCurrentAccount(data.account);
      resetOrderPlanDraft();
      setMainTab("OrderPlan");
      setInventoryPanelTab(getDefaultInventoryPanelTab(data.account.role));
      setAuthInfo(`${signupRole} nalog je uspesno kreiran.`);
      setSignupUsername("");
      setSignupEmail("");
      setSignupPassword("");
      setSignupRole("Worker");
      reloadPage();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  function onLogout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CURRENT_ACCOUNT_STORAGE_KEY);
    }
    setCurrentAccount(null);
    setShowNotificationHistory(false);
    setMainTab("InventoryOrders");
    setInventoryPanelTab(getDefaultInventoryPanelTab(null));
    setInventory([]);
    setOrders([]);
    setOrderRows([]);
    setExecutedPlans([]);
    setNeedsWorkerForOrder(false);
    closeWorkerPicker();
    setError(null);
    setAuthError(null);
    setAuthInfo(null);
    setLoginIdentity("");
    setLoginPassword("");
    setBusy(false);
    reloadPage();
  }

  if (!authReady) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p>Ucitavanje naloga...</p>
        </section>
      </main>
    );
  }

  if (!currentAccount) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="eyebrow">Cutting Optimizer</p>
          <h1>Login / Signup</h1>
          <p className="sub">Pristup aplikaciji je moguc tek nakon prijave.</p>

          <div className="auth-switch" role="group" aria-label="Auth tabs">
            <button
              type="button"
              className={`panel-tab ${authMode === "LOGIN" ? "active" : ""}`}
              onClick={() => {
                setAuthMode("LOGIN");
                setAuthError(null);
              }}
            >
              Login
            </button>
            <button
              type="button"
              className={`panel-tab ${authMode === "SIGNUP" ? "active" : ""}`}
              onClick={() => {
                setAuthMode("SIGNUP");
                setAuthError(null);
              }}
            >
              Signup
            </button>
          </div>

          {authMode === "LOGIN" ? (
            <form className="auth-form" onSubmit={onLoginSubmit}>
              <label>
                Username / Email
                <input
                  value={loginIdentity}
                  onChange={(event) => setLoginIdentity(event.target.value)}
                  placeholder="npr. owner ili owner@cutting.local"
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                />
              </label>
              <button type="submit">Login</button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={onSignupSubmit}>
              <fieldset className="auth-role-picker">
                <legend>Account Type</legend>
                <label className="radio-inline">
                  <input
                    type="radio"
                    name="signup-role"
                    checked={signupRole === "Worker"}
                    onChange={() => setSignupRole("Worker")}
                  />
                  Worker
                </label>
                <label className="radio-inline">
                  <input
                    type="radio"
                    name="signup-role"
                    checked={signupRole === "Customer"}
                    onChange={() => setSignupRole("Customer")}
                  />
                  Customer
                </label>
              </fieldset>
              <label>
                Username
                <input
                  value={signupUsername}
                  onChange={(event) => setSignupUsername(event.target.value)}
                  placeholder="npr. worker1"
                />
              </label>
              <label>
                Email
                <input
                  value={signupEmail}
                  onChange={(event) => setSignupEmail(event.target.value)}
                  placeholder="npr. worker1@firma.com"
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={signupPassword}
                  onChange={(event) => setSignupPassword(event.target.value)}
                />
              </label>
              <p className="auth-note">Izaberi da li se kreira Worker ili Customer nalog.</p>
              <button type="submit">Signup</button>
            </form>
          )}

          <div className="auth-defaults">
            <p className="inventory-table-title">Default nalozi</p>
            <p>Owner: username `owner` / email `owner@cutting.local` / password `owner123`</p>
            <p>Lager: username `lager` / email `lager@cutting.local` / password `lager123`</p>
            <p>Worker: username `worker` / email `worker@cutting.local` / password `worker123`</p>
          </div>

          {authError && <p className="error">{authError}</p>}
          {authInfo && <p className="auth-info">{authInfo}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="hero">
        <div className="session-row">
          <p className="eyebrow">Cutting Optimizer</p>
          <div className="session-meta">
            <span className="session-badge">
              {currentAccount.role}: {currentAccount.username}
            </span>
            <button type="button" onClick={onLogout}>
              Logout
            </button>
          </div>
        </div>
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

      {canAccessSettings && (
        <section className="panel">
          <div className="message-header">
            <h2>Settings</h2>
          </div>
          <div className="settings-actions">
            <Link href="/settings/my-account" className="button-link">
              My Account
            </Link>
            <Link href="/settings/account-manager" className="button-link">
              Account Manager
            </Link>
          </div>
        </section>
      )}

      {currentRole === "Worker" && (
        <section className="panel">
          <div className="message-header">
            <h2>Worker Requests</h2>
          </div>

          {activeWorkerJobs.length === 0 ? (
            <p>Nemate aktivnih zahteva za montazu.</p>
          ) : (
            <div className="message-list">
              {activeWorkerJobs.map((request) => {
                const installationStartDate = getInstallationStartDateText(request.orderAcceptedAt);
                const isAssignedToCurrentWorker = request.acceptedWorkerAccountId === currentAccount.id;

                return (
                  <article key={request.id} className={`message-item ${isAssignedToCurrentWorker ? "assigned-job" : ""}`}>
                    <p className="message-meta">
                      Order ID: <code>{request.orderId}</code> | Kupac: {request.customerUsername} |{" "}
                      {new Date(request.requestedAt).toLocaleString("sr-RS")}
                    </p>
                    <p className="message-body">{buildWorkerRequestMessage(request)}</p>

                    {isAssignedToCurrentWorker ? (
                      <p className="worker-job-status">
                        Prihvacen posao.
                        {installationStartDate
                          ? ` Pocetak rada: ${installationStartDate}.`
                          : " Pocetak rada ce biti poznat nakon sto Owner ili Lager prihvati porudzbinu."}
                      </p>
                    ) : (
                      <div className="worker-job-actions">
                        <button type="button" onClick={() => onWorkerAcceptJob(request.id)}>
                          Accept
                        </button>
                        <button type="button" onClick={() => onWorkerRejectJob(request.id)}>
                          Reject
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="message-header">
          <h2>Poruke</h2>
          <div className="message-actions">
            {currentRole === "Worker" && (
              <button type="button" onClick={onRefreshWorkerMessages} disabled={refreshingMessages}>
                {refreshingMessages ? "Refreshing..." : "Refresh"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowNotificationHistory((prev) => !prev)}
              className={showNotificationHistory ? "history-toggle active" : "history-toggle"}
            >
              History
            </button>
          </div>
        </div>

        {!showNotificationHistory ? (
          unreadNotifications.length === 0 ? (
            <p>Nemate novih poruka.</p>
          ) : (
            <div className="message-list">
              {unreadNotifications.map((notification) => (
                <article key={notification.id} className="message-item unread">
                  <label className="message-read-check">
                    <input
                      type="checkbox"
                      onChange={() => onMarkNotificationAsRead(notification.id)}
                      aria-label={`Oznaci poruku ${notification.orderId} kao procitanu`}
                    />
                  </label>
                  <p className="message-meta">
                    Order ID: <code>{notification.orderId}</code> |{" "}
                    {new Date(notification.createdAt).toLocaleString("sr-RS")}
                  </p>
                  <p className="message-body">{notification.message}</p>
                </article>
              ))}
            </div>
          )
        ) : notificationHistory.length === 0 ? (
          <p>Nemate poruka u history.</p>
        ) : (
          <div className="message-list">
            {notificationHistory.map((notification) => (
              <article key={notification.id} className="message-item">
                <p className="message-meta">
                  Order ID: <code>{notification.orderId}</code> |{" "}
                  {new Date(notification.createdAt).toLocaleString("sr-RS")} |{" "}
                  {notification.readAt ? "Procitano" : "Neprocitano"}
                </p>
                <p className="message-body">{notification.message}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-tabs" role="group" aria-label="Main tabs">
          {canViewInventoryOrders && (
            <button
              type="button"
              aria-pressed={mainTab === "InventoryOrders"}
              className={`panel-tab ${mainTab === "InventoryOrders" ? "active" : ""}`}
              onClick={() => setMainTab("InventoryOrders")}
            >
              Inventory / Orders
            </button>
          )}
          {canViewOrderPlan && (
            <button
              type="button"
              aria-pressed={mainTab === "OrderPlan"}
              className={`panel-tab ${mainTab === "OrderPlan" ? "active" : ""}`}
              onClick={() => setMainTab("OrderPlan")}
            >
              Order Plan
            </button>
          )}
        </div>
      </section>

      {canViewInventoryOrders && mainTab === "InventoryOrders" && (
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
                      <th>User</th>
                      <th>Role</th>
                      <th>Need Worker</th>
                      <th>Worker</th>
                      <th>Klasa</th>
                      {showOrdersHeightColumn && <th>Height</th>}
                      <th>Width</th>
                      <th>Qty</th>
                      <th>Akcija</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((order) => {
                      const workerRequest = workerJobRequestByOrderId.get(order.id);
                      const canManageWorker = order.createdByRole === "Customer" && order.needsWorker;
                      const workerLabel = workerRequest?.acceptedWorkerUsername
                        ? workerRequest.acceptedWorkerUsername
                        : workerRequest && workerRequest.assignments.length > 0
                          ? `Poslato: ${workerRequest.assignments.map((assignment) => assignment.workerUsername).join(", ")}`
                          : "-";

                      return (
                        <tr key={order.id}>
                          <td>{order.createdByUsername || order.createdByEmail || "-"}</td>
                          <td>{order.createdByRole}</td>
                          <td>
                            {canManageWorker && !workerRequest?.acceptedWorkerUsername ? (
                              <button type="button" disabled={busy} onClick={() => openWorkerPicker(order)}>
                                Get a Worker
                              </button>
                            ) : order.needsWorker ? (
                              "Da"
                            ) : (
                              "Ne"
                            )}
                          </td>
                          <td>{workerLabel}</td>
                          <td>{order.inventoryClass}</td>
                          {showOrdersHeightColumn && <td>{order.heightMm ?? "-"}</td>}
                          <td>{order.widthMm}</td>
                          <td>{order.qty}</td>
                          <td>
                            <div className="table-actions">
                              {order.status === "PENDING" ? (
                                <button type="button" disabled={busy} onClick={() => onAcceptOrder(order.id)}>
                                  Accept
                                </button>
                              ) : (
                                <span>{workerRequest?.acceptedWorkerUsername ?? "Accepted"}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
      )}

      {canViewOrderPlan && mainTab === "OrderPlan" && (
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

          {currentRole === "Customer" && (
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={needsWorkerForOrder}
                onChange={(event) => onCustomerNeedsWorkerChange(event.target.checked)}
              />
              I need a Worker
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

      {canViewOrderPlan && (
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
      )}

      {workerPickerOrder && (
        <div className="modal-backdrop" role="presentation" onClick={closeWorkerPicker}>
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Get a Worker"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Get a Worker</h2>
            <p className="message-meta">
              Order ID: <code>{workerPickerOrder.id}</code> | Kupac: {workerPickerOrder.createdByUsername}
            </p>
            <p className="message-body">{formatOrderForMessage(workerPickerOrder)}</p>
            {workerAccounts.length === 0 ? (
              <p>Nema registrovanih Workera.</p>
            ) : (
              <div className="worker-picker-list">
                {workerAccounts.map((worker) => (
                  <label key={worker.id} className="worker-picker-item">
                    <input
                      type="checkbox"
                      checked={selectedWorkerIds.includes(worker.id)}
                      onChange={() => onToggleWorkerForRequest(worker.id)}
                    />
                    <span>
                      {worker.username} <small>({worker.email})</small>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" onClick={onSendWorkerRequest} disabled={workerAccounts.length === 0}>
                Send Message
              </button>
              <button type="button" onClick={closeWorkerPicker}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}
