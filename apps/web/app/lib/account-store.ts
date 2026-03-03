export type AccountRole = "Owner" | "Lager" | "Worker" | "Customer";

export type UserAccount = {
  id: string;
  username: string;
  email: string;
  password: string;
  role: AccountRole;
  createdAt: string;
};

export const ACCOUNTS_STORAGE_KEY = "cutting-materials.accounts";
export const CURRENT_ACCOUNT_STORAGE_KEY = "cutting-materials.current-account";
export const NOTIFICATIONS_STORAGE_KEY = "cutting-materials.notifications";

export const DEFAULT_ACCOUNTS: UserAccount[] = [
  {
    id: "seed-owner",
    username: "owner",
    email: "owner@cutting.local",
    password: "owner123",
    role: "Owner",
    createdAt: "2026-02-23T00:00:00.000Z"
  },
  {
    id: "seed-lager",
    username: "lager",
    email: "lager@cutting.local",
    password: "lager123",
    role: "Lager",
    createdAt: "2026-02-23T00:00:00.000Z"
  },
  {
    id: "seed-worker",
    username: "worker",
    email: "worker@cutting.local",
    password: "worker123",
    role: "Worker",
    createdAt: "2026-02-23T00:00:00.000Z"
  }
];

export function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

export function isAccountRole(value: unknown): value is AccountRole {
  return value === "Owner" || value === "Lager" || value === "Worker" || value === "Customer";
}

export function isUserAccount(value: unknown): value is UserAccount {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<UserAccount>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.username === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.password === "string" &&
    typeof candidate.createdAt === "string" &&
    isAccountRole(candidate.role)
  );
}

export function mergeWithDefaultAccounts(storedAccounts: UserAccount[]): UserAccount[] {
  const existingKeys = new Set(
    storedAccounts.map((account) => `${normalizeIdentity(account.username)}|${normalizeIdentity(account.email)}`)
  );
  const merged = [...storedAccounts];

  for (const defaultAccount of DEFAULT_ACCOUNTS) {
    const key = `${normalizeIdentity(defaultAccount.username)}|${normalizeIdentity(defaultAccount.email)}`;
    if (!existingKeys.has(key)) {
      merged.push(defaultAccount);
    }
  }

  return merged;
}

export function resolveCurrentAccount(
  accountId: string | null,
  accounts: UserAccount[]
): UserAccount | null {
  if (!accountId) {
    return null;
  }

  return accounts.find((account) => account.id === accountId) ?? null;
}

export function formatAccountCreatedAt(value: string): string {
  return new Date(value).toLocaleString("sr-RS");
}
