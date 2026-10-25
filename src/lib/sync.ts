import { supabase } from "@/integrations/supabase/client";
import { db, getMeta, setMeta, clearUserData } from "./db";
import { SYNC_TABLES, type OutboxTable, type SyncStatus } from "./types";

const NUMERIC_FIELDS: Record<OutboxTable, string[]> = {
  products: ["price", "stock"],
  customers: [],
  transactions: ["subtotal", "discount", "total", "paid_amount", "change_amount"],
  transaction_items: ["qty", "price", "total"],
  cash_flows: ["amount"],
  settings: [],
};

export const SUPABASE_COLUMNS: Record<OutboxTable, string[]> = {
  products: [
    "id",
    "user_id",
    "name",
    "category",
    "price",
    "stock",
    "track_stock",
    "active",
    "created_at",
    "updated_at",
  ],
  customers: ["id", "user_id", "name", "phone", "note", "created_at", "updated_at"],
  transactions: [
    "id",
    "user_id",
    "receipt_no",
    "customer_id",
    "payment_method",
    "subtotal",
    "discount",
    "total",
    "paid_amount",
    "change_amount",
    "note",
    "created_at",
    "updated_at",
  ],
  transaction_items: [
    "id",
    "user_id",
    "transaction_id",
    "product_id",
    "name",
    "qty",
    "price",
    "total",
    "updated_at",
  ],
  cash_flows: [
    "id",
    "user_id",
    "type",
    "amount",
    "note",
    "occurred_at",
    "created_at",
    "updated_at",
  ],
  settings: [
    "user_id",
    "store_name",
    "store_address",
    "store_phone",
    "receipt_footer",
    "paper_width",
    "updated_at",
  ],
};

function sanitizeRowForSupabase(
  table: OutboxTable,
  row: Record<string, unknown>,
  userId: string | null,
): Record<string, unknown> {
  const allowed = SUPABASE_COLUMNS[table] || [];
  const out: Record<string, unknown> = {};
  for (const col of allowed) {
    if (row[col] !== undefined) {
      out[col] = row[col];
    }
  }
  for (const field of NUMERIC_FIELDS[table] ?? []) {
    if (out[field] != null) out[field] = Number(out[field]);
  }
  // Sanitize UUID fields agar tidak mengirim string kosong "" ke kolom UUID PostgreSQL
  const UUID_FIELDS = ["customer_id", "product_id", "transaction_id"];
  for (const field of UUID_FIELDS) {
    if (out[field] === "") {
      out[field] = null;
    }
  }
  if (userId && (!out.user_id || out.user_id === "anonymous")) {
    out.user_id = userId;
  }
  return out;
}

function normalizeRow(table: OutboxTable, row: Record<string, unknown>) {
  const out = { ...row };
  for (const field of NUMERIC_FIELDS[table] ?? []) {
    if (out[field] != null) out[field] = Number(out[field]);
  }
  return out;
}

let currentUserId: string | null = null;
let initialized = false;
let syncing = false;
let pendingSync = false;
let syncTimer: number | undefined;
let debounceTimer: number | undefined;
let status: SyncStatus = "idle";
let lastError: string | null = null;
let pendingCount = 0;
const listeners = new Set<() => void>();

export function subscribeSync(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function getSyncState(): {
  status: SyncStatus;
  lastError: string | null;
  pendingCount: number;
} {
  return { status, lastError, pendingCount };
}

export function getUserId(): string | null {
  return currentUserId;
}

function setStatus(next: SyncStatus) {
  if (status !== next) {
    status = next;
    notify();
  }
}

export async function updatePendingCount(): Promise<void> {
  const count = await db.outbox.count();
  if (count !== pendingCount) {
    pendingCount = count;
    notify();
  }
}

export async function clearOutboxQueue(): Promise<void> {
  await db.outbox.clear();
  await updatePendingCount();
}

export function scheduleSync(delayMs = 2000) {
  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    void syncNow();
  }, delayMs);
}

export async function enqueueUpsert(table: OutboxTable, row: Record<string, unknown>) {
  const withTs = { ...row, updated_at: row.updated_at ?? new Date().toISOString() };
  await db.outbox.add({ table, op: "upsert", row: withTs });
  await updatePendingCount();
  scheduleSync();
}

export async function enqueueDelete(table: OutboxTable, id: string) {
  await setMeta(`tomb:${table}:${id}`, true);
  await db.outbox.add({ table, op: "delete", row: { id } });
  await updatePendingCount();
  scheduleSync();
}

async function isTombstoned(table: OutboxTable, id: string): Promise<boolean> {
  return Boolean(await getMeta(`tomb:${table}:${id}`));
}

async function flushOutbox(): Promise<void> {
  const entries = await db.outbox.orderBy("seq").toArray();
  for (const entry of entries) {
    try {
      if (entry.op === "upsert") {
        const payload = sanitizeRowForSupabase(entry.table, entry.row, currentUserId);
        const { error } = await supabase.from(entry.table).upsert(payload);
        if (error) {
          console.error("Sync upsert error on", entry.table, error);
          const msg = (error.message || "").toLowerCase();
          const isNetworkError =
            msg.includes("failed to fetch") ||
            msg.includes("networkerror") ||
            msg.includes("timeout") ||
            error.code === "57001";

          if (
            msg.includes("jwt") ||
            error.code === "PGRST301" ||
            (error as unknown as { status?: number }).status === 401
          ) {
            try {
              await supabase.auth.refreshSession();
            } catch {
              // ignore
            }
          }

          if (!isNetworkError) {
            // Drop permanent/schema error entry to prevent queue blocking
            console.warn(
              "Dropping permanent error outbox entry:",
              entry.table,
              entry.seq,
              error.message,
            );
            await db.outbox.delete(entry.seq!);
            await updatePendingCount();
            continue;
          }
          throw error;
        }
      } else {
        const pk = entry.table === "settings" ? "user_id" : "id";
        const { error } = await supabase
          .from(entry.table)
          .delete()
          .eq(pk, entry.row.id as string);
        if (error) {
          console.error("Sync delete error on", entry.table, error);
          const msg = (error.message || "").toLowerCase();
          const isNetworkError =
            msg.includes("failed to fetch") ||
            msg.includes("networkerror") ||
            msg.includes("timeout") ||
            error.code === "57001";

          if (!isNetworkError) {
            console.warn(
              "Dropping permanent error outbox entry:",
              entry.table,
              entry.seq,
              error.message,
            );
            await db.outbox.delete(entry.seq!);
            await updatePendingCount();
            continue;
          }
          throw error;
        }
      }
      await db.outbox.delete(entry.seq!);
      await updatePendingCount();
    } catch (err: unknown) {
      console.warn("Sync queue paused due to network issue:", err);
      return;
    }
  }
}

async function pullTable(table: OutboxTable): Promise<void> {
  const metaKey = `lastPull:${table}`;
  const store = db[table as keyof typeof db] as never as {
    count: () => Promise<number>;
    get: (id: string) => Promise<Record<string, unknown> | undefined>;
    put: (row: Record<string, unknown>) => Promise<unknown>;
  };
  const localCount = await store.count();
  let cursor = (await getMeta<string>(metaKey)) ?? "1970-01-01T00:00:00.000Z";
  // Jika database lokal masih kosong untuk tabel ini (misal di device baru), wajib tarik dari awal!
  if (localCount === 0) {
    cursor = "1970-01-01T00:00:00.000Z";
  }
  const startCursor = cursor;

  for (let page = 0; page < 100; page++) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .gt("updated_at", cursor)
      .order("updated_at", { ascending: true })
      .limit(500);
    if (error) {
      console.error("Pull failed", table, error);
      return;
    }
    if (!data || data.length === 0) break;
    for (const raw of data) {
      const row = normalizeRow(table, raw);
      const id = row.id as string;
      if (await isTombstoned(table, id)) continue;
      const local = await store.get(id);
      const localTs = (local?.updated_at as string) ?? "";
      if (!local || localTs <= (row.updated_at as string)) {
        await store.put(row);
      }
    }
    cursor = (data[data.length - 1] as { updated_at: string }).updated_at;
    if (data.length < 500) break;
  }
  if (cursor > startCursor) {
    await setMeta(metaKey, cursor);
  }
}

async function pullSettings(): Promise<void> {
  if (!currentUserId) return;
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", currentUserId)
    .maybeSingle();
  if (error || !data) return;
  const local = await db.settings.get(currentUserId);
  if (!local || local.updated_at <= data.updated_at) {
    await db.settings.put(normalizeRow("settings", data) as never);
  }
}

export async function syncNow(): Promise<void> {
  if (syncing) {
    pendingSync = true;
    return;
  }
  if (!currentUserId) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user?.id) {
        currentUserId = data.session.user.id;
      } else {
        return;
      }
    } catch {
      return;
    }
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    setStatus("offline");
    return;
  }
  syncing = true;
  setStatus("syncing");
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setStatus("idle");
      return;
    }
    await flushOutbox();
    await pullSettings();
    for (const table of SYNC_TABLES) {
      await pullTable(table);
    }

    // Jika data transaksi di Supabase cloud sudah kosong (direset dari perangkat lain),
    // bersihkan juga data transaksi lokal agar perangkat ini ikut bersih
    if (currentUserId) {
      try {
        const { count: serverTxCount, error: txCountErr } = await supabase
          .from("transactions")
          .select("*", { count: "exact", head: true });
        if (!txCountErr && serverTxCount === 0 && (await db.transactions.count()) > 0) {
          const now = new Date().toISOString();
          await Promise.all([
            db.transactions.clear(),
            db.transaction_items.clear(),
            db.cash_flows.clear(),
            db.draft_orders.clear(),
            db.meta.delete("active_shift"),
            db.meta.delete("shift_history"),
            db.meta.put({ key: "lastPull:transactions", value: now }),
            db.meta.put({ key: "lastPull:transaction_items", value: now }),
            db.meta.put({ key: "lastPull:cash_flows", value: now }),
          ]);
          if (typeof window !== "undefined" && window.localStorage) {
            localStorage.removeItem("pos_active_shift");
            localStorage.removeItem("pos_shift_history");
            localStorage.removeItem("pos_draft_orders");
          }
        }
      } catch {
        // ignore
      }
    }
    lastError = null;
    setStatus(navigator.onLine ? "idle" : "offline");
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    setStatus("error");
  } finally {
    syncing = false;
    await updatePendingCount();
    notify();
    if (pendingSync) {
      pendingSync = false;
      scheduleSync(1000);
    }
  }
}

async function handleUserSwitch(userId: string) {
  let previous = await getMeta<string>("lastUserId");
  if (!previous && typeof window !== "undefined" && window.localStorage) {
    previous = localStorage.getItem("pos_last_user_id") || undefined;
  }
  if (previous && previous !== userId) {
    await clearUserData();
  }
  currentUserId = userId;
  await setMeta("lastUserId", userId);
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem("pos_last_user_id", userId);
    } catch {
      // ignore
    }
  }
  await updatePendingCount();
  void syncNow();
}

export function initSync(): () => void {
  if (initialized) return () => undefined;
  initialized = true;

  // Immediately resolve active session if available
  supabase.auth.getSession().then(({ data: { session } }) => {
    const userId = session?.user?.id ?? null;
    if (userId && !currentUserId) {
      currentUserId = userId;
      void handleUserSwitch(userId);
    }
  });

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const userId = session?.user?.id ?? null;
    if (event === "SIGNED_OUT") {
      currentUserId = null;
      setStatus("idle");
      return;
    }
    if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
      if (userId && userId !== currentUserId) {
        void handleUserSwitch(userId);
      } else if (userId) {
        scheduleSync(0);
      }
    }
  });

  const onOnline = () => {
    setStatus("idle");
    scheduleSync(0);
  };
  const onOffline = () => setStatus("offline");
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  if (!navigator.onLine) setStatus("offline");
  syncTimer = window.setInterval(() => void syncNow(), 30000);

  return () => {
    data.subscription.unsubscribe();
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    if (syncTimer) window.clearInterval(syncTimer);
  };
}
