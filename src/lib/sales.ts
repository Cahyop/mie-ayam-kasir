import { db } from "./db";
import { enqueueDelete, enqueueUpsert, getUserId } from "./sync";
import { makeReceiptNo, uid } from "./format";
import type { CartItem, PaymentMethod, Transaction, TransactionItem } from "./types";

export type CheckoutInput = {
  cart: CartItem[];
  paymentMethod: PaymentMethod;
  paidAmount: number;
  discount: number;
  customerId: string | null;
  note: string | null;
};

export type CheckoutResult = {
  transaction: Transaction;
  items: TransactionItem[];
};

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const userId = getUserId();
  if (!userId) throw new Error("Belum masuk akun");

  const now = new Date().toISOString();
  const subtotal = input.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discount = Math.max(0, input.discount || 0);
  const total = Math.max(0, subtotal - discount);
  const paid = input.paidAmount;
  const change = input.paymentMethod === "cash" ? Math.max(0, paid - total) : 0;

  const transaction: Transaction = {
    id: uid(),
    user_id: userId,
    receipt_no: makeReceiptNo(),
    customer_id: input.customerId,
    payment_method: input.paymentMethod,
    subtotal,
    discount,
    total,
    paid_amount: paid,
    change_amount: change,
    note: input.note,
    created_at: now,
    updated_at: now,
  };

  const items: TransactionItem[] = input.cart.map((item) => ({
    id: uid(),
    user_id: userId,
    transaction_id: transaction.id,
    product_id: item.product_id,
    name: item.name,
    qty: item.qty,
    price: item.price,
    total: item.price * item.qty,
    updated_at: now,
  }));

  // Decrement stock locally, collect product rows to sync.
  const stockUpdates: { id: string; stock: number }[] = [];
  for (const item of input.cart) {
    if (!item.product_id) continue;
    const product = await db.products.get(item.product_id);
    if (!product || !product.track_stock) continue;
    const newStock = Math.max(0, product.stock - item.qty);
    if (newStock !== product.stock) stockUpdates.push({ id: product.id, stock: newStock });
  }

  const outboxEntries: {
    table: "transactions" | "transaction_items" | "products";
    row: Record<string, unknown>;
  }[] = [
    { table: "transactions", row: { ...transaction } },
    ...items.map((item) => ({ table: "transaction_items" as const, row: { ...item } })),
    ...stockUpdates.map((update) => ({ table: "products" as const, row: update })),
  ];

  // Outbox rows are full rows; merge stock updates with existing products on flush.
  await db.transaction(
    "rw",
    [db.transactions, db.transaction_items, db.products, db.outbox],
    async () => {
      await db.transactions.put(transaction);
      await db.transaction_items.bulkPut(items);
      for (const update of stockUpdates) {
        const product = await db.products.get(update.id);
        if (product) {
          await db.products.put({ ...product, stock: update.stock, updated_at: now });
        }
      }
      for (const entry of outboxEntries) {
        if (entry.table === "products") {
          const product = await db.products.get(entry.row.id as string);
          if (product) {
            await db.outbox.add({ table: "products", op: "upsert", row: { ...product } });
          }
          continue;
        }
        await db.outbox.add({ table: entry.table, op: "upsert", row: entry.row });
      }
    },
  );

  return { transaction, items };
}

export async function deleteTransaction(id: string): Promise<void> {
  await db.transaction("rw", [db.transactions, db.transaction_items, db.outbox], async () => {
    await db.transactions.delete(id);
    await db.transaction_items.where("transaction_id").equals(id).delete();
    await db.outbox.add({ table: "transactions", op: "delete", row: { id } });
  });
  await enqueueDelete("transactions", id);
}

export async function getTransactionItems(transactionId: string): Promise<TransactionItem[]> {
  return db.transaction_items.where("transaction_id").equals(transactionId).toArray();
}

export async function saveCashFlow(input: {
  type: "modal" | "in" | "out";
  amount: number;
  note: string | null;
  occurredAt: string;
}) {
  const userId = getUserId();
  if (!userId) throw new Error("Belum masuk akun");
  const now = new Date().toISOString();
  const row = {
    id: uid(),
    user_id: userId,
    type: input.type,
    amount: input.amount,
    note: input.note,
    occurred_at: input.occurredAt,
    created_at: now,
    updated_at: now,
  };
  await db.cash_flows.put(row);
  await enqueueUpsert("cash_flows", row);
  return row;
}

export async function deleteCashFlow(id: string) {
  await db.cash_flows.delete(id);
  await enqueueDelete("cash_flows", id);
}
