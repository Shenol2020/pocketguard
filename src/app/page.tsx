"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/* ───────────────────── IndexedDB Persistence ──────────────── */
const DB_NAME = "pocketguard_db";
const DB_STORE = "state";
const DB_KEY = "app_state";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToIDB(data: AppState): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(data, DB_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback to localStorage
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* noop */ }
  }
}

async function loadFromIDB(): Promise<AppState | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(DB_KEY);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function clearIDB(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(DB_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* noop */ }
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

/* ───────────────────────── Types ───────────────────────── */
interface Expense {
  id: string;
  amount: number;
  note: string;
  timestamp: number;
}

interface DayLog {
  date: string; // YYYY-MM-DD
  expenses: Expense[];
}

interface AppState {
  initialBalance: number;
  mainBalance: number;
  savings: number;
  startDate: string; // YYYY-MM-DD
  totalDays: number;
  dayLogs: DayLog[];
  initialized: boolean;
}

type ToastType = "success" | "warning" | "error";

/* ───────────────────────── Helpers ─────────────────────── */
const STORAGE_KEY = "pocketguard_state";

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const daysBetween = (a: string, b: string): number => {
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  return Math.floor((db.getTime() - da.getTime()) / 86400000);
};

const formatCurrency = (n: number): string =>
  "Rs." +
  n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const shortDate = (iso: string): string => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const timeStr = (ts: number): string =>
  new Date(ts).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

const defaultState = (): AppState => ({
  initialBalance: 0,
  mainBalance: 0,
  savings: 0,
  startDate: today(),
  totalDays: 30,
  dayLogs: [],
  initialized: false,
});

/* ───────────────────────── Component ──────────────────── */
export default function Home() {
  const [state, setState] = useState<AppState>(defaultState);
  const [loaded, setLoaded] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseNote, setExpenseNote] = useState("");
  const [setupBalance, setSetupBalance] = useState("");
  const [setupDays, setSetupDays] = useState("30");
  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ── persistence (IndexedDB primary, localStorage fallback) ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Try IndexedDB first
      let data = await loadFromIDB();
      // Fallback: migrate from localStorage if IndexedDB was empty
      if (!data) {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            data = JSON.parse(raw);
            // Migrate to IndexedDB
            if (data) await saveToIDB(data);
          }
        } catch { /* noop */ }
      }
      if (!cancelled && data) setState(data);
      if (!cancelled) setLoaded(true);
      // Request persistent storage so the browser never evicts our data
      if (navigator.storage?.persist) {
        navigator.storage.persist();
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (loaded) {
      saveToIDB(state);
      // Also keep localStorage in sync as secondary backup
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* noop */ }
    }
  }, [state, loaded]);

  /* ── toast ── */
  const showToast = useCallback((msg: string, type: ToastType = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2400);
  }, []);

  /* ── derived values ── */
  const currentDate = today();
  const elapsedDays = state.initialized
    ? daysBetween(state.startDate, currentDate)
    : 0;
  const remainingDays = Math.max(state.totalDays - elapsedDays, 1);
  const dailyLimit = state.mainBalance / remainingDays;

  const todayLog = state.dayLogs.find((d) => d.date === currentDate);
  const todaySpent = todayLog
    ? todayLog.expenses.reduce((s, e) => s + e.amount, 0)
    : 0;
  const todayRemaining = Math.max(dailyLimit - todaySpent, 0);
  const spentRatio = dailyLimit > 0 ? Math.min(todaySpent / dailyLimit, 1) : 0;

  const totalSpent = state.dayLogs.reduce(
    (sum, d) => sum + d.expenses.reduce((s, e) => s + e.amount, 0),
    0
  );
  const budgetUsedPercent =
    state.initialBalance > 0
      ? Math.min((totalSpent / state.initialBalance) * 100, 100)
      : 0;
  const daysCompleted = Math.min(elapsedDays, state.totalDays);

  /* ── initialize ── */
  const handleSetup = () => {
    const bal = parseFloat(setupBalance);
    const days = parseInt(setupDays, 10);
    if (!bal || bal <= 0) {
      showToast("Enter a valid balance", "error");
      return;
    }
    if (!days || days < 1 || days > 365) {
      showToast("Days must be 1–365", "error");
      return;
    }
    setState({
      initialBalance: bal,
      mainBalance: bal,
      savings: 0,
      startDate: currentDate,
      totalDays: days,
      dayLogs: [],
      initialized: true,
    });
    showToast("Budget initialized! 🚀");
  };

  /* ── log expense (CORE LOGIC) ── */
  const handleExpense = () => {
    const amt = parseFloat(expenseAmount);
    if (!amt || amt <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }

    const expense: Expense = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      amount: amt,
      note: expenseNote.trim() || "Expense",
      timestamp: Date.now(),
    };

    setState((prev) => {
      const logs = [...prev.dayLogs];
      let dayIdx = logs.findIndex((d) => d.date === currentDate);
      if (dayIdx === -1) {
        logs.push({ date: currentDate, expenses: [] });
        dayIdx = logs.length - 1;
      }
      logs[dayIdx] = {
        ...logs[dayIdx],
        expenses: [...logs[dayIdx].expenses, expense],
      };

      const dayTotal = logs[dayIdx].expenses.reduce((s, e) => s + e.amount, 0);
      const currentDailyLimit = prev.mainBalance / Math.max(prev.totalDays - daysBetween(prev.startDate, currentDate), 1);

      let newMainBalance = prev.mainBalance;
      let newSavings = prev.savings;

      if (dayTotal <= currentDailyLimit) {
        // Within limit: deduct full daily limit from main, surplus goes to savings
        // We recalculate incrementally: the daily limit's worth is deducted,
        // and the unspent portion is "saved".
        // On each expense we just track; the "end of day" settlement happens implicitly
        // by computing remaining = dailyLimit - dayTotal.
        // For real-time tracking:
        newMainBalance = prev.initialBalance - totalSpentIncluding(logs);
        const surplusToday = currentDailyLimit - dayTotal;
        // Savings = all past surpluses. We recompute from scratch for correctness.
        newSavings = recomputeSavings(logs, prev.initialBalance, prev.startDate, prev.totalDays);
      } else {
        // Over limit: excess comes from savings first, then main balance
        const excess = dayTotal - currentDailyLimit;
        newSavings = prev.savings;
        
        // Recompute everything for correctness
        const result = recomputeBalances(logs, prev.initialBalance, prev.startDate, prev.totalDays);
        newMainBalance = result.mainBalance;
        newSavings = result.savings;
      }

      return {
        ...prev,
        mainBalance: Math.max(newMainBalance, 0),
        savings: Math.max(newSavings, 0),
        dayLogs: logs,
      };
    });

    setExpenseAmount("");
    setExpenseNote("");
    inputRef.current?.focus();

    if (amt > dailyLimit) {
      showToast("Over daily limit! Deducted from savings.", "warning");
    } else {
      showToast(`Rs.${amt.toFixed(2)} logged ✓`);
    }
  };

  /* ── delete expense ── */
  const deleteExpense = (date: string, expenseId: string) => {
    setState((prev) => {
      const logs = prev.dayLogs
        .map((d) =>
          d.date === date
            ? { ...d, expenses: d.expenses.filter((e) => e.id !== expenseId) }
            : d
        )
        .filter((d) => d.expenses.length > 0);

      const result = recomputeBalances(logs, prev.initialBalance, prev.startDate, prev.totalDays);
      return {
        ...prev,
        mainBalance: Math.max(result.mainBalance, 0),
        savings: Math.max(result.savings, 0),
        dayLogs: logs,
      };
    });
    showToast("Expense removed");
  };

  /* ── reset ── */
  const handleReset = () => {
    setState(defaultState());
    setShowReset(false);
    clearIDB();
    showToast("All data cleared");
  };

  /* ── loading ── */
  if (!loaded) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-t-transparent border-[var(--accent-teal)] rounded-full animate-spin" />
      </main>
    );
  }

  /* ═══════════════════ SETUP SCREEN ═══════════════════ */
  if (!state.initialized) {
    return (
      <main className="flex-1 flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-md animate-fade-up">
          {/* Logo */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-[var(--accent-emerald)] to-[var(--accent-teal)] mb-5 shadow-lg">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#050d1a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold gradient-text mb-2">PocketGuard</h1>
            <p className="text-[var(--text-secondary)] text-sm">
              Set your monthly budget and start tracking
            </p>
          </div>

          {/* Form */}
          <div className="glass-card p-6 space-y-5">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
                Starting Balance (Rs.)
              </label>
              <input
                id="setup-balance"
                type="number"
                inputMode="decimal"
                className="input-field text-2xl font-bold"
                placeholder="30,000"
                value={setupBalance}
                onChange={(e) => setSetupBalance(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
                Budget Period (days)
              </label>
              <input
                id="setup-days"
                type="number"
                inputMode="numeric"
                className="input-field"
                placeholder="30"
                value={setupDays}
                onChange={(e) => setSetupDays(e.target.value)}
                min={1}
                max={365}
              />
            </div>
            <button
              id="btn-setup"
              className="btn-primary w-full text-center text-lg"
              onClick={handleSetup}
            >
              Start Tracking →
            </button>
          </div>

          <p className="text-center text-[var(--text-muted)] text-xs mt-6">
            100% offline · No sign-up · Data stays on this device
          </p>
        </div>
      </main>
    );
  }

  /* ═══════════════════ MAIN DASHBOARD ═══════════════════ */
  return (
    <main className="flex-1 px-4 pt-4 pb-28 max-w-lg mx-auto w-full">
      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between mb-6 animate-fade-in">
        <div>
          <h1 className="text-lg font-bold gradient-text">PocketGuard</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Day {Math.min(elapsedDays + 1, state.totalDays)} of {state.totalDays} · {shortDate(currentDate)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            id="btn-history"
            className="w-10 h-10 rounded-xl flex items-center justify-center border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] transition-colors"
            onClick={() => setShowHistory(!showHistory)}
            aria-label="Toggle history"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {showHistory ? (
                <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
              ) : (
                <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>
              )}
            </svg>
          </button>
          <button
            id="btn-reset-header"
            className="h-10 px-3 rounded-xl flex items-center justify-center gap-1.5 border border-[rgba(251,113,133,0.15)] text-[var(--accent-rose)] hover:bg-[rgba(251,113,133,0.08)] transition-colors text-xs font-medium"
            onClick={() => setShowReset(true)}
            aria-label="Reset"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
            Reset
          </button>
        </div>
      </header>

      {!showHistory ? (
        <div className="space-y-4 stagger">
          {/* ── Daily Budget Card ── */}
          <div className="glass-card p-5 animate-fade-up" style={{ boxShadow: "var(--glow-emerald)" }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                Today&apos;s Limit
              </span>
              <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                spentRatio > 0.9
                  ? "bg-[rgba(251,113,133,0.12)] text-[var(--accent-rose)]"
                  : spentRatio > 0.6
                  ? "bg-[rgba(251,191,36,0.12)] text-[var(--accent-amber)]"
                  : "bg-[rgba(52,211,153,0.12)] text-[var(--accent-emerald)]"
              }`}>
                {(spentRatio * 100).toFixed(0)}% used
              </span>
            </div>
            <div className="text-3xl font-bold font-mono animate-count-up mb-1">
              {formatCurrency(dailyLimit)}
            </div>
            <div className="progress-track mb-3">
              <div
                className={`progress-fill ${spentRatio > 0.8 ? "warning" : ""}`}
                style={{ width: `${spentRatio * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-[var(--text-muted)]">
              <span>Spent: {formatCurrency(todaySpent)}</span>
              <span>Left: {formatCurrency(todayRemaining)}</span>
            </div>
          </div>

          {/* ── Balance Cards ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-4 animate-fade-up">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--accent-sky)] to-blue-600 flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z"/>
                  </svg>
                </div>
                <span className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">Main</span>
              </div>
              <div className="text-lg font-bold font-mono text-[var(--accent-sky)] animate-count-up">
                {formatCurrency(state.mainBalance)}
              </div>
            </div>
            <div className="glass-card p-4 animate-fade-up">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--accent-emerald)] to-green-600 flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-0.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2z"/>
                  </svg>
                </div>
                <span className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">Savings</span>
              </div>
              <div className="text-lg font-bold font-mono text-[var(--accent-emerald)] animate-count-up">
                {formatCurrency(state.savings)}
              </div>
            </div>
          </div>

          {/* ── Overall Progress ── */}
          <div className="glass-card p-4 animate-fade-up">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[var(--text-secondary)]">Budget Progress</span>
              <span className="text-xs font-mono text-[var(--text-muted)]">
                {daysCompleted}/{state.totalDays} days
              </span>
            </div>
            <div className="progress-track">
              <div
                className={`progress-fill ${budgetUsedPercent > 85 ? "warning" : ""}`}
                style={{ width: `${budgetUsedPercent}%` }}
              />
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-[var(--text-muted)]">
              <span>Spent: {formatCurrency(totalSpent)}</span>
              <span>Budget: {formatCurrency(state.initialBalance)}</span>
            </div>
          </div>

          {/* ── Expense Input ── */}
          <div className="glass-card p-5 animate-fade-up" style={{ boxShadow: "var(--glow-sky)" }}>
            <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-4 uppercase tracking-wider">
              Log Expense
            </h2>
            <div className="space-y-3">
              <input
                ref={inputRef}
                id="expense-amount"
                type="number"
                inputMode="decimal"
                className="input-field text-xl font-bold"
                placeholder="Rs. Amount"
                value={expenseAmount}
                onChange={(e) => setExpenseAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleExpense()}
              />
              <input
                id="expense-note"
                type="text"
                className="input-field text-sm"
                placeholder="What was it for? (optional)"
                value={expenseNote}
                onChange={(e) => setExpenseNote(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleExpense()}
              />
              <button
                id="btn-log-expense"
                className="btn-primary w-full text-center"
                onClick={handleExpense}
                disabled={!expenseAmount}
              >
                Add Expense
              </button>
            </div>
          </div>

          {/* ── Today's Expenses ── */}
          {todayLog && todayLog.expenses.length > 0 && (
            <div className="glass-card p-5 animate-fade-up">
              <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
                Today&apos;s Expenses
              </h2>
              <div className="space-y-2">
                {todayLog.expenses.map((exp) => (
                  <div
                    key={exp.id}
                    className="flex items-center justify-between py-2 px-3 rounded-xl bg-[var(--bg-input)] group hover:bg-[var(--bg-card-hover)] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{exp.note}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{timeStr(exp.timestamp)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-semibold text-[var(--accent-rose)]">
                        −{formatCurrency(exp.amount)}
                      </span>
                      <button
                        className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-rose)] hover:bg-[rgba(251,113,133,0.1)] transition-all"
                        onClick={() => deleteExpense(currentDate, exp.id)}
                        aria-label="Delete expense"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}


        </div>
      ) : (
        /* ═══════════════════ HISTORY VIEW ═══════════════════ */
        <div className="space-y-4 animate-fade-up">
          <h2 className="text-lg font-bold">Spending History</h2>
          {state.dayLogs.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <p className="text-[var(--text-muted)]">No expenses logged yet</p>
            </div>
          ) : (
            [...state.dayLogs].reverse().map((day) => {
              const dayTotal = day.expenses.reduce((s, e) => s + e.amount, 0);
              return (
                <div key={day.date} className="glass-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold">{shortDate(day.date)}</span>
                    <span className="text-sm font-mono font-semibold text-[var(--accent-rose)]">
                      −{formatCurrency(dayTotal)}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {day.expenses.map((exp) => (
                      <div
                        key={exp.id}
                        className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-[var(--bg-input)] group"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-xs truncate block">{exp.note}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">{timeStr(exp.timestamp)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono">{formatCurrency(exp.amount)}</span>
                          <button
                            className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-rose)] transition-all"
                            onClick={() => deleteExpense(day.date, exp.id)}
                            aria-label="Delete"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Reset Confirmation Overlay ── */}
      {showReset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-5"
          style={{ backgroundColor: "rgba(5, 13, 26, 0.85)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
          onClick={() => setShowReset(false)}
        >
          <div
            className="glass-card p-6 w-full max-w-sm space-y-4 animate-slide-down"
            style={{ boxShadow: "var(--glow-rose)", border: "1px solid rgba(251,113,133,0.2)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[rgba(251,113,133,0.12)] flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-rose)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)]">Reset Everything?</h3>
                <p className="text-xs text-[var(--text-muted)]">This cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              All your expenses, balances, and savings data will be permanently deleted.
            </p>
            <div className="flex gap-3 pt-1">
              <button className="btn-ghost flex-1" onClick={() => setShowReset(false)}>
                Cancel
              </button>
              <button id="btn-confirm-reset" className="btn-danger flex-1" onClick={handleReset}>
                Delete All Data
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}

/* ═══════════════════ PURE COMPUTATION ═══════════════════ */

/**
 * Sum of all expenses across all day logs
 */
function totalSpentIncluding(logs: DayLog[]): number {
  return logs.reduce(
    (sum, d) => sum + d.expenses.reduce((s, e) => s + e.amount, 0),
    0
  );
}

/**
 * Recompute savings from scratch by replaying the daily logic:
 *  - Each completed day: if spent < dailyLimit → surplus goes to savings
 *  - If spent > dailyLimit → excess is deducted from savings (then main balance)
 */
function recomputeSavings(
  logs: DayLog[],
  initialBalance: number,
  startDate: string,
  totalDays: number
): number {
  return recomputeBalances(logs, initialBalance, startDate, totalDays).savings;
}

/**
 * Full replay of the budget engine to recompute main balance and savings.
 * This is called whenever expenses are added or deleted for correctness.
 */
function recomputeBalances(
  logs: DayLog[],
  initialBalance: number,
  startDate: string,
  totalDays: number
): { mainBalance: number; savings: number } {
  // Sort logs by date
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));

  let mainBalance = initialBalance;
  let savings = 0;

  for (const day of sorted) {
    const elapsed = daysBetween(startDate, day.date);
    const remaining = Math.max(totalDays - elapsed, 1);
    const dailyLimit = mainBalance / remaining;
    const daySpent = day.expenses.reduce((s, e) => s + e.amount, 0);

    if (daySpent <= dailyLimit) {
      // Under budget: deduct full daily limit, surplus to savings
      const surplus = dailyLimit - daySpent;
      mainBalance -= dailyLimit;
      savings += surplus;
    } else {
      // Over budget: deduct daily limit from main, excess from savings then main
      const excess = daySpent - dailyLimit;
      mainBalance -= dailyLimit;

      if (savings >= excess) {
        savings -= excess;
      } else {
        const remaining_excess = excess - savings;
        savings = 0;
        mainBalance -= remaining_excess;
      }
    }
  }

  return {
    mainBalance: Math.max(mainBalance, 0),
    savings: Math.max(savings, 0),
  };
}
