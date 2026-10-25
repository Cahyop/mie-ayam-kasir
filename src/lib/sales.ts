import { db, getMeta } from "./db";
import { enqueueDelete, enqueueUpsert, getUserId, scheduleSync, updatePendingCount } from "./sync";
import { makeReceiptNo, uid } from "./format";
import { refreshClosedShiftSummary } from "./shift";
import type {
  CartItem,
  ItemOrderType,
  OrderType,
  PaymentMethod,
  RegisterShift,
  Transaction,
  TransactionItem,
} from "./types";

export type CheckoutInput = {
  cart: CartItem[];
  paymentMethod: PaymentMethod;
  paidAmount: number;
  discount: number;
  customerId: string | null;
  note: string | null;
  orderType?: OrderType;
};

export type UpdateTransactionInput = {
  transactionId: string;
  cart: CartItem[];
  paymentMethod: PaymentMethod;
  paidAmount: number;
  discount: number;
  customerId: string | null;
  note: string | null;
  orderType?: OrderType;
};

export type CheckoutResult = {
  transaction: Transaction;
  items: TransactionItem[];
};

export function computeTransactionOrderType(items: { order_type?: ItemOrderType }[]): OrderType {
  if (items.length === 0) return "dine_in";
  const hasDineIn = items.some((i) => (i.order_type || "dine_in") === "dine_in");
  const hasTakeAway = items.some((i) => i.order_type === "take_away");
  if (hasDineIn && hasTakeAway) return "mixed";
  if (hasTakeAway) return "take_away";
  return "dine_in";
}

export async function getNextReceiptNo(date = new Date()): Promise<string> {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
  const prefix = `R${stamp}-`;

  try {
    const txs = await db.transactions.toArray();
    let maxSeq = 0;

    for (const t of txs) {
      if (t.receipt_no && t.receipt_no.startsWith(prefix)) {
        const numPart = parseInt(t.receipt_no.slice(prefix.length), 10);
        if (!isNaN(numPart)) {
          // Abaikan jika ada nomor acak lama yang nilainya jauh melampaui jumlah transaksi
          if (numPart > maxSeq && (numPart <= txs.length + 10 || txs.length > 500)) {
            maxSeq = numPart;
          }
        }
      }
    }

    const nextSeq = maxSeq > 0 ? maxSeq + 1 : 1;
    return makeReceiptNo(nextSeq, date);
  } catch {
    return makeReceiptNo(1, date);
  }
}

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const userId =
    getUserId() ||
    (await getMeta<string>("lastUserId")) ||
    (typeof window !== "undefined" ? localStorage.getItem("pos_last_user_id") : null) ||
    "anonymous";

  const now = new Date().toISOString();
  const subtotal = input.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discount = Math.max(0, input.discount || 0);
  const total = Math.max(0, subtotal - discount);
  const paid = input.paidAmount;
  const change = input.paymentMethod === "cash" ? Math.max(0, paid - total) : 0;
  const receiptNo = await getNextReceiptNo();

  // Ambil shift yang sedang aktif (buka) untuk menghubungkan transaksi ke shift ini
  let shiftId: string | null = null;
  try {
    const activeShift = await getMeta<RegisterShift>("active_shift");
    if (activeShift && activeShift.status === "open") {
      shiftId = activeShift.id;
    }
  } catch {
    // ignore
  }

  const transaction: Transaction = {
    id: uid(),
    user_id: userId,
    receipt_no: receiptNo,
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
    shift_id: shiftId,
    order_type: input.orderType || computeTransactionOrderType(input.cart),
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
    order_type: item.order_type || "dine_in",
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

  await updatePendingCount();
  scheduleSync(500);

  return { transaction, items };
}

export async function updateTransaction(input: UpdateTransactionInput): Promise<CheckoutResult> {
  const userId = getUserId();
  if (!userId) throw new Error("Belum masuk akun");

  const existingTx = await db.transactions.get(input.transactionId);
  if (!existingTx) throw new Error("Transaksi tidak ditemukan");

  const oldItems = await db.transaction_items
    .where("transaction_id")
    .equals(input.transactionId)
    .toArray();

  const now = new Date().toISOString();
  const subtotal = input.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discount = Math.max(0, input.discount || 0);
  const total = Math.max(0, subtotal - discount);
  const paid = input.paidAmount;
  const change = input.paymentMethod === "cash" ? Math.max(0, paid - total) : 0;
  const orderType = input.orderType || computeTransactionOrderType(input.cart);

  const updatedTx: Transaction = {
    ...existingTx,
    customer_id: input.customerId,
    payment_method: input.paymentMethod,
    subtotal,
    discount,
    total,
    paid_amount: paid,
    change_amount: change,
    note: input.note,
    order_type: orderType,
    updated_at: now,
  };

  const newItems: TransactionItem[] = input.cart.map((item) => ({
    id: uid(),
    user_id: userId,
    transaction_id: existingTx.id,
    product_id: item.product_id,
    name: item.name,
    qty: item.qty,
    price: item.price,
    total: item.price * item.qty,
    order_type: item.order_type || "dine_in",
    created_at: existingTx.created_at,
    updated_at: now,
  }));

  // Revert old stock and apply new stock
  // Calculate net stock change: delta = oldQty - newQty
  const productStockDeltas = new Map<string, number>();
  for (const oldItem of oldItems) {
    if (oldItem.product_id) {
      productStockDeltas.set(
        oldItem.product_id,
        (productStockDeltas.get(oldItem.product_id) || 0) + oldItem.qty,
      );
    }
  }
  for (const newItem of input.cart) {
    if (newItem.product_id) {
      productStockDeltas.set(
        newItem.product_id,
        (productStockDeltas.get(newItem.product_id) || 0) - newItem.qty,
      );
    }
  }

  const stockUpdates: { id: string; stock: number }[] = [];
  for (const [productId, delta] of productStockDeltas.entries()) {
    if (delta === 0) continue;
    const product = await db.products.get(productId);
    if (product && product.track_stock) {
      const newStock = Math.max(0, product.stock + delta);
      stockUpdates.push({ id: product.id, stock: newStock });
    }
  }

  await db.transaction(
    "rw",
    [db.transactions, db.transaction_items, db.products, db.outbox],
    async () => {
      await db.transactions.put(updatedTx);
      await db.transaction_items.where("transaction_id").equals(existingTx.id).delete();
      await db.transaction_items.bulkPut(newItems);

      for (const update of stockUpdates) {
        const product = await db.products.get(update.id);
        if (product) {
          await db.products.put({ ...product, stock: update.stock, updated_at: now });
          await db.outbox.add({
            table: "products",
            op: "upsert",
            row: { ...product, stock: update.stock, updated_at: now },
          });
        }
      }

      await db.outbox.add({
        table: "transactions",
        op: "upsert",
        row: { ...updatedTx },
      });

      for (const oldItem of oldItems) {
        await db.outbox.add({
          table: "transaction_items",
          op: "delete",
          row: { id: oldItem.id },
        });
      }

      for (const newItem of newItems) {
        await db.outbox.add({
          table: "transaction_items",
          op: "upsert",
          row: { ...newItem },
        });
      }
    },
  );

  await updatePendingCount();
  scheduleSync(500);

  // If shift is closed, update shift summary so closing report stays accurate
  if (existingTx.shift_id) {
    try {
      await refreshClosedShiftSummary(existingTx.shift_id);
    } catch {
      // ignore
    }
  }

  return { transaction: updatedTx, items: newItems };
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
  const userId =
    getUserId() ||
    (await getMeta<string>("lastUserId")) ||
    (typeof window !== "undefined" ? localStorage.getItem("pos_last_user_id") : null) ||
    "anonymous";
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
