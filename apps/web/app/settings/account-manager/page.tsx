'use client';

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CURRENT_ACCOUNT_STORAGE_KEY,
  formatAccountCreatedAt,
  isUserAccount,
  resolveCurrentAccount,
  type UserAccount
} from "../../lib/account-store";
import { resolveApiBaseUrl } from "../../lib/api";

function sortByCreatedAt(accounts: UserAccount[]): UserAccount[] {
  return [...accounts].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export default function AccountManagerPage() {
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [currentAccount, setCurrentAccount] = useState<UserAccount | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const apiUrl = useMemo(resolveApiBaseUrl, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!apiUrl) {
      setAuthReady(true);
      return;
    }

    fetch(`${apiUrl}/accounts`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Accounts fetch failed (${response.status})`);
        }
        return (await response.json()) as { items?: UserAccount[] };
      })
      .then((data) => {
        const items = Array.isArray(data.items) ? data.items.filter(isUserAccount) : [];
        const currentAccountId = window.localStorage.getItem(CURRENT_ACCOUNT_STORAGE_KEY);
        setAccounts(items);
        setCurrentAccount(resolveCurrentAccount(currentAccountId, items));
      })
      .catch(() => {
        setAccounts([]);
        setCurrentAccount(null);
      })
      .finally(() => {
        setAuthReady(true);
      });
  }, [apiUrl]);

  const workerAccounts = useMemo(() => sortByCreatedAt(accounts.filter((account) => account.role === "Worker")), [accounts]);
  const customerAccounts = useMemo(
    () => sortByCreatedAt(accounts.filter((account) => account.role === "Customer")),
    [accounts]
  );

  if (!authReady) {
    return (
      <main className="page">
        <section className="panel">
          <p>Ucitavanje account managera...</p>
        </section>
      </main>
    );
  }

  if (!currentAccount) {
    return (
      <main className="page">
        <section className="panel">
          <h1>Account Manager</h1>
          <p>Morate biti ulogovani da biste otvorili ovu stranicu.</p>
          <Link href="/" className="button-link">
            Nazad na pocetnu
          </Link>
        </section>
      </main>
    );
  }

  if (currentAccount.role !== "Owner") {
    return (
      <main className="page">
        <section className="panel">
          <h1>Account Manager</h1>
          <p>Pristup ovoj stranici ima samo Owner nalog.</p>
          <Link href="/" className="button-link">
            Nazad na pocetnu
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="panel settings-header-panel">
        <p className="eyebrow">Settings</p>
        <h1>Account Manager</h1>
        <p className="sub">Pregled svih naloga podeljenih po sekcijama Worker i Customer.</p>
        <div className="settings-actions">
          <Link href="/settings/my-account" className="button-link">
            My Account
          </Link>
          <Link href="/" className="button-link">
            Nazad na Dashboard
          </Link>
        </div>
      </section>

      <section className="panel">
        <h2>Overview</h2>
        <div className="settings-grid">
          <article className="settings-card">
            <p className="settings-label">Worker Accounts</p>
            <p className="settings-value">{workerAccounts.length}</p>
          </article>
          <article className="settings-card">
            <p className="settings-label">Customer Accounts</p>
            <p className="settings-value">{customerAccounts.length}</p>
          </article>
          <article className="settings-card">
            <p className="settings-label">Visible Roles</p>
            <p className="settings-value">Worker i Customer</p>
          </article>
        </div>
      </section>

      <section className="panel">
        <h2>Worker</h2>
        {workerAccounts.length === 0 ? (
          <p className="inventory-empty">Nema kreiranih Worker accounta.</p>
        ) : (
          <div className="inventory-table-wrap">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Created</th>
                  <th>Account ID</th>
                </tr>
              </thead>
              <tbody>
                {workerAccounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.username}</td>
                    <td>{account.email}</td>
                    <td>{account.role}</td>
                    <td>{formatAccountCreatedAt(account.createdAt)}</td>
                    <td>
                      <code>{account.id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Customer</h2>
        {customerAccounts.length === 0 ? (
          <p className="inventory-empty">Trenutno nema Customer accounta.</p>
        ) : (
          <div className="inventory-table-wrap">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Created</th>
                  <th>Account ID</th>
                </tr>
              </thead>
              <tbody>
                {customerAccounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.username}</td>
                    <td>{account.email}</td>
                    <td>{account.role}</td>
                    <td>{formatAccountCreatedAt(account.createdAt)}</td>
                    <td>
                      <code>{account.id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
