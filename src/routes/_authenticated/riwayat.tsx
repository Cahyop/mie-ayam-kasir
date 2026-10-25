import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatRupiah, formatDateId, formatTimeId, formatPlain, isToday } from "@/lib/format";
import { getShiftHistory } from "@/lib/shift";
import { syncNow } from "@/lib/sync";
import { ShiftDetailDialog } from "@/components/shift-detail-dialog";
import { EditTransactionDialog } from "@/components/edit-transaction-dialog";
import type { ReceiptData, RegisterShift, Transaction } from "@/lib/types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReceiptDialog } from "@/components/receipt-dialog";
import { cn } from "@/lib/utils";
import {
  Clock,
  FileText,
  ChevronRight,
  ChevronDown,
  ChevronsUpDown,
  ChevronsDownUp,
  Store,
  Pencil,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/riwayat")({
  head: () => ({
    meta: [
      { title: "Riwayat — POS Mie Ayam" },
      { name: "description", content: "Riwayat sesi buka/tutup kasir dan transaksi penjualan." },
    ],
  }),
  component: RiwayatPage,
});

export function RiwayatPage() {
  const transactions = useLiveQuery(
    async () => db.transactions.orderBy("created_at").reverse().limit(500).toArray(),
    [],
  );
  const shifts = useLiveQuery(() => getShiftHistory(), []);
  const settings = useLiveQuery(async () => (await db.settings.toArray())[0], []);
  const customers = useLiveQuery(
    () => db.customers.filter((c) => c.name !== "__DRAFT_ORDER__").toArray(),
    [],
  );

  const [openId, setOpenId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  useEffect(() => {
    void syncNow();
  }, []);

  // Shift Detail Dialog State
  const [selectedShift, setSelectedShift] = useState<RegisterShift | null>(null);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);

  const openTx = transactions?.find((t) => t.id === openId) ?? null;

  // Kelompokkan transaksi berdasarkan sesi buka kasir (Shift)
  const shiftGroups = (shifts ?? []).map((shift) => {
    const list = (transactions ?? []).filter((t) => {
      if (t.shift_id) return t.shift_id === shift.id;
      if (!t.created_at) return false;
      return (
        t.created_at >= shift.opened_at && (!shift.closed_at || t.created_at <= shift.closed_at)
      );
    });

    const omset = list.reduce((sum, t) => sum + t.total, 0);
    const cashCount = list.filter((t) => t.payment_method === "cash").length;
    const qrisCount = list.filter((t) => t.payment_method === "qris").length;

    return {
      shift,
      transactions: list,
      omset,
      cashCount,
      qrisCount,
    };
  });

  // Transaksi yang tidak terikat pada shift manapun (misal sebelum fitur shift ada)
  const assignedTxIds = new Set(shiftGroups.flatMap((g) => g.transactions.map((t) => t.id)));
  const unassignedTxs = (transactions ?? []).filter((t) => !assignedTxIds.has(t.id));

  // Hanya sesi hari ini atau sesi yang sedang buka yang langsung expand secara default
  const [expandedShiftIds, setExpandedShiftIds] = useState<Set<string>>(() => new Set());
  const [initializedShifts, setInitializedShifts] = useState(false);

  useEffect(() => {
    if (shifts && !initializedShifts) {
      const initial = new Set<string>();
      for (const s of shifts) {
        const isCurrentDay = isToday(s.closed_at || s.opened_at);
        if (s.status === "open" || isCurrentDay) {
          initial.add(s.id);
        }
      }
      if (unassignedTxs.some((t) => isToday(t.created_at))) {
        initial.add("unassigned");
      }
      setExpandedShiftIds(initial);
      setInitializedShifts(true);
    }
  }, [shifts, initializedShifts, unassignedTxs]);

  function handleExpandAll() {
    const all = new Set<string>((shifts ?? []).map((s) => s.id));
    if (unassignedTxs.length > 0) all.add("unassigned");
    setExpandedShiftIds(all);
  }

  function handleCollapseAll() {
    setExpandedShiftIds(new Set());
  }

  function toggleShift(shiftId: string) {
    setExpandedShiftIds((prev) => {
      const next = new Set(prev);
      if (next.has(shiftId)) {
        next.delete(shiftId);
      } else {
        next.add(shiftId);
      }
      return next;
    });
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
      items: items.map((i) => ({
        name: i.name,
        qty: i.qty,
        price: i.price,
        total: i.total,
        orderType: i.order_type,
      })),
      subtotal: t.subtotal,
      discount: t.discount,
      total: t.total,
      paymentMethod: t.payment_method,
      paidAmount: t.paid_amount,
      changeAmount: t.change_amount,
      customerName: customer?.name ?? null,
      orderType: t.order_type ?? "dine_in",
    } satisfies ReceiptData;
  }

  const hasAnyData = (shifts && shifts.length > 0) || (transactions && transactions.length > 0);

  return (
    <div className="space-y-4 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Riwayat Sesi &amp; Penjualan</h1>
          <p className="text-xs text-muted-foreground">
            Dikelompokkan per sesi kasir (hari ini terbuka otomatis).
          </p>
        </div>
        {hasAnyData && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExpandAll}
              className="h-7 text-xs px-2 gap-1 font-medium"
            >
              <ChevronsUpDown className="h-3.5 w-3.5" />
              Expand Semua
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCollapseAll}
              className="h-7 text-xs px-2 gap-1 font-medium"
            >
              <ChevronsDownUp className="h-3.5 w-3.5" />
              Collapse Semua
            </Button>
          </div>
        )}
      </div>

      {!hasAnyData && (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Store className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-sm font-semibold">Belum Ada Transaksi</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Buka kasir dan mulai transaksi di tab Kasir untuk melihat riwayat di sini.
          </p>
        </div>
      )}

      {/* Daftar Sesi Buka/Tutup Kasir */}
      {shiftGroups.map(({ shift, transactions: shiftTxs, omset, cashCount, qrisCount }) => {
        const isOpen = shift.status === "open";
        const isCurrentDay = isToday(shift.closed_at || shift.opened_at);
        const isExpanded = expandedShiftIds.has(shift.id);

        const dOpen = new Date(shift.opened_at);
        const dClose = shift.closed_at ? new Date(shift.closed_at) : null;

        const dateLabel = (dClose ?? dOpen).toLocaleDateString("id-ID", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        });

        const timeLabel = `${dOpen.toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
        })} – ${
          dClose
            ? dClose.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
            : "Sekarang"
        }`;

        return (
          <section
            key={shift.id}
            className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs transition-all"
          >
            {/* Header Sesi Kasir */}
            <div
              onClick={() => toggleShift(shift.id)}
              className="border-b border-border bg-muted/40 p-3.5 space-y-2 cursor-pointer hover:bg-muted/60 transition-colors select-none"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full shrink-0",
                      isOpen ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40",
                    )}
                  />
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-foreground">
                        {isOpen ? "Sesi Kasir Aktif (Sedang Buka)" : `Sesi Closing (${dateLabel})`}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] px-1.5 py-0 h-4 font-bold",
                          isOpen
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {isOpen ? "BUKA" : "DITUTUP"}
                      </Badge>
                      {isCurrentDay && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 h-4 font-semibold border-emerald-500/30 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10"
                        >
                          Hari Ini
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {timeLabel}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs font-semibold gap-1 px-2.5 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedShift(shift);
                      setShiftDialogOpen(true);
                    }}
                  >
                    <FileText className="h-3.5 w-3.5 text-primary" />
                    {isOpen ? "Rekap Shift" : "Laporan Closing"}
                  </Button>

                  <div className="flex items-center gap-1 text-muted-foreground text-xs font-semibold pl-1">
                    <span>{isExpanded ? "Tutup" : "Buka"}</span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 transition-transform duration-200",
                        isExpanded && "rotate-180",
                      )}
                    />
                  </div>
                </div>
              </div>

              {/* Ringkasan Angka Shift */}
              <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                <div className="rounded-xl border border-border/60 bg-background/60 p-2">
                  <span className="text-[10px] text-muted-foreground block">Modal Awal</span>
                  <span className="font-semibold text-foreground">
                    {formatRupiah(shift.initial_cash)}
                  </span>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/60 p-2">
                  <span className="text-[10px] text-muted-foreground block">
                    Omset ({shiftTxs.length} nota)
                  </span>
                  <span className="font-bold text-primary">{formatRupiah(omset)}</span>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/60 p-2">
                  <span className="text-[10px] text-muted-foreground block">
                    {isOpen ? "Metode Bayar" : "Selisih Kas"}
                  </span>
                  <span
                    className={cn(
                      "font-semibold block truncate",
                      !isOpen &&
                        (shift.difference === 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : (shift.difference ?? 0) > 0
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-destructive"),
                    )}
                  >
                    {isOpen
                      ? `${cashCount} Tunai · ${qrisCount} QRIS`
                      : shift.difference === 0
                        ? "PAS (Rp 0)"
                        : `${(shift.difference ?? 0) > 0 ? "+" : ""}${formatRupiah(shift.difference ?? 0)}`}
                  </span>
                </div>
              </div>
            </div>

            {/* Daftar Transaksi dalam Sesi Ini (Collapsible) */}
            {isExpanded && (
              <div className="p-3">
                {shiftTxs.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    Belum ada transaksi penjualan pada sesi kasir ini.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {shiftTxs.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setOpenId(t.id)}
                        className="flex w-full items-center justify-between rounded-xl border border-border bg-card p-2.5 text-left transition-colors hover:bg-muted/50 active:scale-[0.99]"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-bold text-foreground">{t.receipt_no}</p>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] px-1.5 py-0 h-4 font-normal",
                                t.order_type === "take_away"
                                  ? "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10"
                                  : t.order_type === "mixed"
                                    ? "border-purple-500/40 text-purple-700 dark:text-purple-400 bg-purple-500/10"
                                    : "border-primary/30 text-primary bg-primary/10",
                              )}
                            >
                              {t.order_type === "take_away"
                                ? "Bungkus"
                                : t.order_type === "mixed"
                                  ? "Campur"
                                  : "Makan di Tempat"}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {formatTimeId(t.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <p className="text-xs font-bold text-foreground">
                              {formatRupiah(t.total)}
                            </p>
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-[10px] px-1.5 py-0 h-4 font-semibold",
                                t.payment_method === "cash"
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : "text-sky-700 dark:text-sky-400",
                              )}
                            >
                              {t.payment_method === "cash" ? "Tunai" : "QRIS"}
                            </Badge>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}

      {/* Transaksi yang Belum/Tidak Terikat Shift */}
      {unassignedTxs.length > 0 && (
        <section className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
          <div
            onClick={() => toggleShift("unassigned")}
            className="flex items-center justify-between p-3.5 bg-muted/40 hover:bg-muted/60 transition-colors cursor-pointer select-none border-b border-border"
          >
            <div>
              <p className="text-xs font-bold text-foreground">
                Transaksi Lainnya ({unassignedTxs.length} nota)
              </p>
              <p className="text-[11px] text-muted-foreground">
                Transaksi di luar sesi kasir yang tercatat
              </p>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground text-xs font-semibold">
              <span>{expandedShiftIds.has("unassigned") ? "Tutup" : "Buka"}</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  expandedShiftIds.has("unassigned") && "rotate-180",
                )}
              />
            </div>
          </div>
          {expandedShiftIds.has("unassigned") && (
            <div className="p-3 space-y-1.5">
              {unassignedTxs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setOpenId(t.id)}
                  className="flex w-full items-center justify-between rounded-xl border border-border bg-card p-2.5 text-left transition-colors hover:bg-muted/50 active:scale-[0.99]"
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-bold text-foreground">{t.receipt_no}</p>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1.5 py-0 h-4 font-normal",
                          t.order_type === "take_away"
                            ? "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10"
                            : t.order_type === "mixed"
                              ? "border-purple-500/40 text-purple-700 dark:text-purple-400 bg-purple-500/10"
                              : "border-primary/30 text-primary bg-primary/10",
                        )}
                      >
                        {t.order_type === "take_away"
                          ? "Bungkus"
                          : t.order_type === "mixed"
                            ? "Campur"
                            : "Makan di Tempat"}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDateId(t.created_at)} · {formatTimeId(t.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-xs font-bold text-foreground">{formatRupiah(t.total)}</p>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] px-1.5 py-0 h-4 font-semibold",
                          t.payment_method === "cash"
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-sky-700 dark:text-sky-400",
                        )}
                      >
                        {t.payment_method === "cash" ? "Tunai" : "QRIS"}
                      </Badge>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Sheet Rincian Nota & Tombol Cetak Ulang Struk */}
      <TransactionSheet
        transaction={openTx}
        onClose={() => setOpenId(null)}
        onEdit={() => {
          setEditingTx(openTx);
        }}
        onReceipt={(data) => {
          setOpenId(null);
          setReceipt(data);
        }}
        buildReceipt={buildReceipt}
      />

      {/* Dialog Koreksi Transaksi */}
      <EditTransactionDialog
        transaction={editingTx}
        open={!!editingTx}
        onOpenChange={(o) => !o && setEditingTx(null)}
        onSaved={() => {
          setEditingTx(null);
          setOpenId(null);
        }}
      />

      {/* Dialog Cetak Struk Penjualan */}
      <ReceiptDialog
        receipt={receipt}
        onClose={() => setReceipt(null)}
        paperWidth={settings?.paper_width ?? "58"}
      />

      {/* Dialog Detail Shift / Cetak Ulang Laporan Closing */}
      <ShiftDetailDialog
        shift={selectedShift}
        open={shiftDialogOpen}
        onOpenChange={setShiftDialogOpen}
        storeName={settings?.store_name ?? "Mie Ayam"}
        storePhone={settings?.store_phone}
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
  onEdit,
  onReceipt,
  buildReceipt,
}: {
  transaction: Transaction | null;
  onClose: () => void;
  onEdit: () => void;
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
          <div className="flex items-center justify-between pr-6">
            <SheetTitle>{transaction.receipt_no}</SheetTitle>
            <Badge
              variant="outline"
              className={cn(
                "text-xs px-2 py-0.5 font-medium",
                transaction.order_type === "take_away"
                  ? "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10"
                  : transaction.order_type === "mixed"
                    ? "border-purple-500/40 text-purple-700 dark:text-purple-400 bg-purple-500/10"
                    : "border-primary/30 text-primary bg-primary/10",
              )}
            >
              {transaction.order_type === "take_away"
                ? "Bungkus"
                : transaction.order_type === "mixed"
                  ? "Campur"
                  : "Makan di Tempat"}
            </Badge>
          </div>
        </SheetHeader>
        <div className="space-y-1 pb-2 text-sm mt-3">
          {items?.map((item) => (
            <div key={item.id} className="flex justify-between items-center py-0.5">
              <div className="flex items-center gap-1.5">
                <span>
                  {formatPlain(item.qty)}× {item.name}
                </span>
                {transaction.order_type === "mixed" && item.order_type === "take_away" && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1 py-0 h-4 border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10"
                  >
                    Bungkus
                  </Badge>
                )}
              </div>
              <span>{formatRupiah(item.total)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-border pt-2 font-bold">
            <span>Total</span>
            <span>{formatRupiah(transaction.total)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground text-xs">
            <span>Bayar ({transaction.payment_method === "cash" ? "Tunai" : "QRIS"})</span>
            <span>{formatRupiah(transaction.paid_amount)}</span>
          </div>
          {transaction.payment_method === "cash" && transaction.change_amount > 0 && (
            <div className="flex justify-between text-muted-foreground text-xs">
              <span>Kembalian</span>
              <span>{formatRupiah(transaction.change_amount)}</span>
            </div>
          )}
        </div>
        <div className="pt-2 pb-4 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onEdit}
            className="w-full text-xs h-10 font-bold gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" />
            Koreksi Transaksi
          </Button>
          <Button
            disabled={!data}
            onClick={() => data && onReceipt(data)}
            className="w-full text-xs h-10 font-bold"
          >
            Cetak Ulang
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
