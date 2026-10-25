import Dexie, { type Table } from "dexie";
import type {
  CashFlow,
  Customer,
  DraftOrder,
  OutboxEntry,
  Product,
  Settings,
  Transaction,
  TransactionItem,
} from "./types";

export type MetaEntry = { key: string; value: unknown };

class PosDatabase extends Dexie {
  products!: Table<Product, string>;
  customers!: Table<Customer, string>;
  transactions!: Table<Transaction, string>;
  transaction_items!: Table<TransactionItem, string>;
  cash_flows!: Table<CashFlow, string>;
  settings!: Table<Settings, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;
  draft_orders!: Table<DraftOrder, string>;

  constructor() {
    super("pos-mie-ayam");
    this.version(1).stores({
      products: "id, updated_at, active, category",
      customers: "id, updated_at",
      transactions: "id, updated_at, created_at",
      transaction_items: "id, transaction_id, updated_at",
      cash_flows: "id, updated_at, occurred_at",
      settings: "user_id",
      outbox: "++seq",
      meta: "key",
    });
    this.version(2).stores({
      products: "id, name, updated_at, active, category",
      customers: "id, name, updated_at",
    });
    this.version(3).stores({
      draft_orders: "id, table_no, customer_name, updated_at, created_at",
    });
  }
}

export const db = new PosDatabase();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const entry = await db.meta.get(key);
  return entry?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function resetTransactionData(): Promise<void> {
  const now = new Date().toISOString();

  // 1. Hapus dari Supabase Cloud jika akun sedang login
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id) {
      await supabase.from("transaction_items").delete().eq("user_id", user.id);
      await supabase.from("transactions").delete().eq("user_id", user.id);
      await supabase.from("cash_flows").delete().eq("user_id", user.id);
    }
  } catch (err) {
    console.warn("Gagal menghapus data transaksi dari Supabase cloud:", err);
  }

  // 2. Hapus dari IndexedDB lokal dan perbarui kursor sinkronisasi
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

  // 3. Bersihkan cache di localStorage
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.removeItem("pos_active_shift");
      localStorage.removeItem("pos_shift_history");
      localStorage.removeItem("pos_draft_orders");
    } catch {
      // ignore
    }
  }

  // 4. Bersihkan antrean outbox terkait
  try {
    await db.outbox
      .filter((entry) => ["transactions", "transaction_items", "cash_flows"].includes(entry.table))
      .delete();
  } catch {
    // ignore
  }
  try {
    const { updatePendingCount } = await import("./sync");
    await updatePendingCount();
  } catch {
    // ignore
  }
}

export async function clearUserData(): Promise<void> {
  await Promise.all([
    db.products.clear(),
    db.customers.clear(),
    db.transactions.clear(),
    db.transaction_items.clear(),
    db.cash_flows.clear(),
    db.settings.clear(),
    db.outbox.clear(),
    db.meta.clear(),
    db.draft_orders.clear(),
  ]);
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.removeItem("pos_active_shift");
      localStorage.removeItem("pos_shift_history");
      localStorage.removeItem("pos_draft_orders");
      localStorage.removeItem("pos_last_user_id");
    } catch {
      // ignore
    }
  }
}
