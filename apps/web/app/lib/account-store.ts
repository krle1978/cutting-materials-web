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
