import Dexie, { type Table } from "dexie";
import type {
  CashFlow,
  Customer,
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
  await Promise.all([
    db.transactions.clear(),
    db.transaction_items.clear(),
    db.cash_flows.clear(),
    db.meta.delete("active_shift"),
    db.meta.delete("shift_history"),
  ]);
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
  ]);
}
