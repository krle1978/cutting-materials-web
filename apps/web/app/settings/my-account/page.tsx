'use client';

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ACCOUNTS_STORAGE_KEY,
  CURRENT_ACCOUNT_STORAGE_KEY,
  DEFAULT_ACCOUNTS,
  formatAccountCreatedAt,
  isUserAccount,
  mergeWithDefaultAccounts,
  resolveCurrentAccount,
  type UserAccount
} from "../../lib/account-store";

export default function MyAccountPage() {
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [currentAccount, setCurrentAccount] = useState<UserAccount | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const rawAccounts = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY);
      const parsedAccounts = rawAccounts ? (JSON.parse(rawAccounts) as unknown) : [];
      const storedAccounts = Array.isArray(parsedAccounts) ? parsedAccounts.filter(isUserAccount) : [];
      const mergedAccounts = mergeWithDefaultAccounts(storedAccounts);
      const currentAccountId = window.localStorage.getItem(CURRENT_ACCOUNT_STORAGE_KEY);

      setAccounts(mergedAccounts);
      setCurrentAccount(resolveCurrentAccount(currentAccountId, mergedAccounts));
    } catch {
      setAccounts(DEFAULT_ACCOUNTS);
      setCurrentAccount(null);
    } finally {
      setAuthReady(true);
    }
  }, []);

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
