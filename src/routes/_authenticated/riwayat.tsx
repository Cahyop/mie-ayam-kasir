import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatRupiah, formatDateId, formatTimeId, formatPlain } from "@/lib/format";
import type { ReceiptData, Transaction } from "@/lib/types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ReceiptDialog } from "@/components/receipt-dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/riwayat")({
  head: () => ({
    meta: [
      { title: "Riwayat — POS Mie Ayam" },
      { name: "description", content: "Riwayat transaksi penjualan dan cetak ulang struk." },
    ],
  }),
  component: RiwayatPage,
});

export function RiwayatPage() {
  const transactions = useLiveQuery(
    async () => db.transactions.orderBy("created_at").reverse().limit(300).toArray(),
    [],
  );
  const settings = useLiveQuery(async () => (await db.settings.toArray())[0], []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const open = transactions?.find((t) => t.id === openId) ?? null;

  const groups = new Map<string, Transaction[]>();
  for (const t of transactions ?? []) {
    const day = t.created_at.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(t);
  }

  function buildReceipt(t: Transaction, items: Awaited<ReturnType<typeof loadItems>>) {
    const customer = customers?.find((c) => c.id === t.customer_id);
    return {
      receiptNo: t.receipt_no,
      createdAt: t.created_at,
      storeName: settings?.store_name ?? "Mie Ayam",
      storeAddress: settings?.store_address ?? null,
      storePhone: settings?.store_phone ?? null,
      footer: settings?.receipt_footer ?? "",
      items: items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, total: i.total })),
      subtotal: t.subtotal,
      discount: t.discount,
      total: t.total,
      paymentMethod: t.payment_method,
      paidAmount: t.paid_amount,
      changeAmount: t.change_amount,
      customerName: customer?.name ?? null,
    } satisfies ReceiptData;
  }

  return (
    <div>
      <h1 className="mb-3 text-lg font-bold">Riwayat Penjualan</h1>
      {!transactions?.length && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Belum ada transaksi. Mulai jualan di tab Kasir.
        </p>
      )}
      {[...groups.entries()].map(([day, list]) => (
        <div key={day} className="mb-5">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">
            {formatDateId(list[0].created_at)}
          </p>
          <div className="space-y-2">
            {list.map((t) => (
              <button
                key={t.id}
                onClick={() => setOpenId(t.id)}
                className="flex w-full items-center justify-between rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40 active:scale-[0.99]"
              >
                <div>
                  <p className="text-sm font-semibold">{t.receipt_no}</p>
                  <p className="text-xs text-muted-foreground">{formatTimeId(t.created_at)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">{formatRupiah(t.total)}</p>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "mt-0.5",
                      t.payment_method === "cash" ? "text-emerald-700" : "text-sky-700",
                    )}
                  >
                    {t.payment_method === "cash" ? "Tunai" : "QRIS"}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      <TransactionSheet
        transaction={open}
        onClose={() => setOpenId(null)}
        onReceipt={(data) => {
          setOpenId(null);
          setReceipt(data);
        }}
        buildReceipt={buildReceipt}
      />

      <ReceiptDialog
        receipt={receipt}
        onClose={() => setReceipt(null)}
        paperWidth={settings?.paper_width ?? "58"}
      />
    </div>
  );
}

async function loadItems(transactionId: string) {
  return db.transaction_items.where("transaction_id").equals(transactionId).toArray();
}

function TransactionSheet({
  transaction,
  onClose,
  onReceipt,
  buildReceipt,
}: {
  transaction: Transaction | null;
  onClose: () => void;
  onReceipt: (data: ReceiptData) => void;
  buildReceipt: (t: Transaction, items: Awaited<ReturnType<typeof loadItems>>) => ReceiptData;
}) {
  const items = useLiveQuery(
    async () => (transaction ? loadItems(transaction.id) : []),
    [transaction?.id],
  );

  if (!transaction) return null;
  const data = items ? buildReceipt(transaction, items) : null;

  return (
    <Sheet open={!!transaction} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-3xl px-4">
        <SheetHeader>
          <SheetTitle>{transaction.receipt_no}</SheetTitle>
        </SheetHeader>
        <div className="space-y-1 pb-2 text-sm">
          {items?.map((item) => (
            <div key={item.id} className="flex justify-between">
              <span>
                {formatPlain(item.qty)}× {item.name}
              </span>
              <span>{formatRupiah(item.total)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-border pt-2 font-bold">
            <span>Total</span>
            <span>{formatRupiah(transaction.total)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Bayar ({transaction.payment_method === "cash" ? "Tunai" : "QRIS"})</span>
            <span>{formatRupiah(transaction.paid_amount)}</span>
          </div>
          {transaction.payment_method === "cash" && (
            <div className="flex justify-between text-muted-foreground">
              <span>Kembalian</span>
              <span>{formatRupiah(transaction.change_amount)}</span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 pb-4">
          <button
            disabled={!data}
            onClick={() => data && onReceipt(data)}
            className="rounded-xl border border-border bg-card py-2.5 text-sm font-semibold disabled:opacity-50 hover:bg-accent/40"
          >
            Struk / Kirim
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
