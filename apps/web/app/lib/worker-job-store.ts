export type WorkerJobAssignmentStatus = "PENDING" | "REJECTED" | "ACCEPTED";

export type WorkerJobAssignment = {
  workerAccountId: string;
  workerUsername: string;
  workerEmail: string;
  status: WorkerJobAssignmentStatus;
  respondedAt: string | null;
};

export type WorkerJobRequest = {
  id: string;
  orderId: string;
  inventoryClass: string;
  heightMm: number | null;
  widthMm: number;
  qty: number;
  customerUsername: string;
  customerEmail: string;
  requestedAt: string;
  orderAcceptedAt: string | null;
  acceptedWorkerAccountId: string | null;
  acceptedWorkerUsername: string | null;
  assignments: WorkerJobAssignment[];
};

export const WORKER_JOB_REQUESTS_STORAGE_KEY = "cutting-materials.worker-job-requests";

export function isWorkerJobRequest(value: unknown): value is WorkerJobRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkerJobRequest>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.orderId === "string" &&
    typeof candidate.inventoryClass === "string" &&
    typeof candidate.widthMm === "number" &&
    typeof candidate.qty === "number" &&
    typeof candidate.customerUsername === "string" &&
    typeof candidate.customerEmail === "string" &&
    typeof candidate.requestedAt === "string" &&
    (candidate.orderAcceptedAt === null ||
      candidate.orderAcceptedAt === undefined ||
      typeof candidate.orderAcceptedAt === "string") &&
    (candidate.acceptedWorkerAccountId === null ||
      candidate.acceptedWorkerAccountId === undefined ||
      typeof candidate.acceptedWorkerAccountId === "string") &&
    (candidate.acceptedWorkerUsername === null ||
      candidate.acceptedWorkerUsername === undefined ||
      typeof candidate.acceptedWorkerUsername === "string") &&
    Array.isArray(candidate.assignments)
  );
}

export function normalizeWorkerJobRequest(request: WorkerJobRequest): WorkerJobRequest {
  return {
    ...request,
    orderAcceptedAt:
      typeof request.orderAcceptedAt === "string" && request.orderAcceptedAt.length > 0
        ? request.orderAcceptedAt
        : null,
    acceptedWorkerAccountId:
      typeof request.acceptedWorkerAccountId === "string" && request.acceptedWorkerAccountId.length > 0
        ? request.acceptedWorkerAccountId
        : null,
    acceptedWorkerUsername:
      typeof request.acceptedWorkerUsername === "string" && request.acceptedWorkerUsername.length > 0
        ? request.acceptedWorkerUsername
        : null,
    assignments: Array.isArray(request.assignments)
      ? request.assignments
          .filter(isWorkerJobAssignment)
          .map((assignment) => ({
            ...assignment,
            respondedAt:
              typeof assignment.respondedAt === "string" && assignment.respondedAt.length > 0
                ? assignment.respondedAt
                : null
          }))
      : []
  };
}

export function getInstallationStartDateText(orderAcceptedAt: string | null): string | null {
  if (!orderAcceptedAt) {
    return null;
  }

  const acceptedDate = new Date(orderAcceptedAt);
  if (Number.isNaN(acceptedDate.getTime())) {
    return null;
  }

  acceptedDate.setDate(acceptedDate.getDate() + 2);
  return new Intl.DateTimeFormat("sr-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(acceptedDate);
}

function isWorkerJobAssignment(value: unknown): value is WorkerJobAssignment {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkerJobAssignment>;
  return (
    typeof candidate.workerAccountId === "string" &&
    typeof candidate.workerUsername === "string" &&
    typeof candidate.workerEmail === "string" &&
    (candidate.status === "PENDING" || candidate.status === "REJECTED" || candidate.status === "ACCEPTED") &&
    (candidate.respondedAt === null ||
      candidate.respondedAt === undefined ||
      typeof candidate.respondedAt === "string")
  );
}
