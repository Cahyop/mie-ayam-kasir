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

async function updatePendingCount() {
  const count = await db.outbox.count();
  if (count !== pendingCount) {
    pendingCount = count;
    notify();
  }
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
        const { error } = await supabase.from(entry.table).upsert(entry.row);
        if (error) {
          // Structural errors would retry forever — drop the entry instead.
          if (error.code && !["23503", "409", "57001"].includes(error.code)) {
            console.error("Sync upsert failed permanently", entry.table, error);
            await db.outbox.delete(entry.seq!);
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
          if (error.code && !["23503", "409", "57001"].includes(error.code)) {
            console.error("Sync delete failed permanently", entry.table, error);
            await db.outbox.delete(entry.seq!);
            continue;
          }
          throw error;
        }
      }
      await db.outbox.delete(entry.seq!);
      await updatePendingCount();
    } catch {
      // Network/auth problem — stop flushing, retry on next tick.
      return;
    }
  }
}

async function pullTable(table: OutboxTable): Promise<void> {
  const metaKey = `lastPull:${table}`;
  let cursor = (await getMeta<string>(metaKey)) ?? "1970-01-01T00:00:00.000Z";
  const startCursor = cursor;
  const store = db[table as keyof typeof db] as never as {
    get: (id: string) => Promise<Record<string, unknown> | undefined>;
    put: (row: Record<string, unknown>) => Promise<unknown>;
  };

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
  if (cursor > startCursor || startCursor === "1970-01-01T00:00:00.000Z") {
    await setMeta(metaKey, cursor > startCursor ? cursor : new Date().toISOString());
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
  if (!currentUserId) return;
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
    lastError = null;
    setStatus(navigator.onLine ? "idle" : "offline");
  } catch (error) {
    lastError = String(error);
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
  const previous = await getMeta<string>("lastUserId");
  if (previous && previous !== userId) {
    await clearUserData();
  }
  currentUserId = userId;
  await setMeta("lastUserId", userId);
  await updatePendingCount();
  void syncNow();
}

export function initSync(): () => void {
  if (initialized) return () => undefined;
  initialized = true;

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const userId = session?.user?.id ?? null;
    if (event === "SIGNED_OUT") {
      currentUserId = null;
      void clearUserData();
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
