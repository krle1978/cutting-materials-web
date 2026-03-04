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

export default function MyAccountPage() {
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

  const ownerAccount = useMemo(() => {
    if (currentAccount?.role === "Owner") {
      return currentAccount;
    }

    return accounts.find((account) => account.role === "Owner") ?? null;
  }, [accounts, currentAccount]);

  if (!authReady) {
    return (
      <main className="page">
        <section className="panel">
          <p>Ucitavanje owner naloga...</p>
        </section>
      </main>
    );
  }

  if (!currentAccount) {
    return (
      <main className="page">
        <section className="panel">
          <h1>My Account</h1>
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
          <h1>My Account</h1>
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
        <h1>My Account</h1>
        <p className="sub">Pregled osnovnih podataka i privilegija za Owner account.</p>
        <Link href="/" className="button-link">
          Nazad na Dashboard
        </Link>
      </section>

      <section className="panel">
        <h2>Owner Account</h2>
        {ownerAccount ? (
          <div className="settings-grid">
            <article className="settings-card">
              <p className="settings-label">Username</p>
              <p className="settings-value">{ownerAccount.username}</p>
            </article>
            <article className="settings-card">
              <p className="settings-label">Email</p>
              <p className="settings-value">{ownerAccount.email}</p>
            </article>
            <article className="settings-card">
              <p className="settings-label">Role</p>
              <p className="settings-value">{ownerAccount.role}</p>
            </article>
            <article className="settings-card">
              <p className="settings-label">Created</p>
              <p className="settings-value">{formatAccountCreatedAt(ownerAccount.createdAt)}</p>
            </article>
            <article className="settings-card">
              <p className="settings-label">Account ID</p>
              <p className="settings-value">
                <code>{ownerAccount.id}</code>
              </p>
            </article>
            <article className="settings-card">
              <p className="settings-label">Password</p>
              <p className="settings-value">Skriven iz bezbednosnih razloga.</p>
            </article>
          </div>
        ) : (
          <p>Owner nalog nije pronadjen.</p>
        )}
      </section>

      <section className="panel">
        <h2>Owner Privileges</h2>
        <div className="settings-grid">
          <article className="settings-card">
            <p className="settings-label">Inventory / Orders</p>
            <p className="settings-value">Pun pristup pregledu lagera i prihvatanju porudzbina.</p>
          </article>
          <article className="settings-card">
            <p className="settings-label">Order Plan</p>
            <p className="settings-value">Moze da kreira i prati planove secenja.</p>
          </article>
          <article className="settings-card">
            <p className="settings-label">Notifications</p>
            <p className="settings-value">Moze da vidi poruke i istoriju notifikacija.</p>
          </article>
          <article className="settings-card">
            <p className="settings-label">Settings</p>
            <p className="settings-value">Jedini ima pristup My Account i Account Manager stranicama.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
