import { useEffect, useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { updateTransaction, computeTransactionOrderType } from "@/lib/sales";
import { formatRupiah, formatPlain, parseNumberInput } from "@/lib/format";
import type {
  CartItem,
  Customer,
  ItemOrderType,
  OrderType,
  Product,
  Transaction,
} from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Plus, Minus, Trash2, Utensils, ShoppingBag, Loader2, AlertCircle } from "lucide-react";

export type EditTransactionDialogProps = {
  transaction: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (updatedTx: Transaction) => void;
};

export function EditTransactionDialog({
  transaction,
  open,
  onOpenChange,
  onSaved,
}: EditTransactionDialogProps) {
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), []);
  const customers = useLiveQuery(
    () =>
      db.customers
        .toArray()
        .then((list) =>
          list
            .filter((c) => c.name !== "__DRAFT_ORDER__")
            .sort((a, b) => a.name.localeCompare(b.name, "id-ID")),
        ),
    [],
  );

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable states
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [discount, setDiscount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qris">("cash");
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [note, setNote] = useState<string>("");
  const [selectedProductId, setSelectedProductId] = useState<string>("");

  useEffect(() => {
    if (!open || !transaction) return;

    let isMounted = true;
    setLoading(true);

    async function loadData() {
      try {
        const items = await db.transaction_items
          .where("transaction_id")
          .equals(transaction!.id)
          .toArray();

        if (!isMounted) return;

        setCart(
          items.map((i) => ({
            product_id: i.product_id,
            name: i.name,
            price: i.price,
            qty: i.qty,
            order_type: i.order_type || "dine_in",
          })),
        );
        setCustomerId(transaction!.customer_id);
        setDiscount(transaction!.discount || 0);
        setPaymentMethod(transaction!.payment_method);
        setPaidAmount(transaction!.paid_amount);
        setNote(transaction!.note || "");
      } catch (err) {
        console.error("Gagal memuat item transaksi", err);
        toast.error("Gagal memuat rincian transaksi");
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [open, transaction]);

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const grandTotal = Math.max(0, subtotal - discount);
  const change = paymentMethod === "cash" ? Math.max(0, paidAmount - grandTotal) : 0;
  const currentOrderType = computeTransactionOrderType(cart);

  function changeQty(index: number, delta: number) {
    setCart((prev) =>
      prev
        .map((item, idx) => (idx === index ? { ...item, qty: item.qty + delta } : item))
        .filter((item) => item.qty > 0),
    );
  }

  function toggleItemOrderType(itemIndex: number) {
    setCart((prev) => {
      const target = prev[itemIndex];
      if (!target) return prev;
      const currentType = target.order_type || "dine_in";
      const newType: ItemOrderType = currentType === "take_away" ? "dine_in" : "take_away";

      const existingOther = prev.findIndex(
        (item, i) =>
          i !== itemIndex &&
          item.product_id === target.product_id &&
          (item.order_type || "dine_in") === newType,
      );
      if (existingOther > -1) {
        return prev
          .map((item, i) => (i === existingOther ? { ...item, qty: item.qty + target.qty } : item))
          .filter((_, i) => i !== itemIndex);
      }
      return prev.map((item, i) => (i === itemIndex ? { ...item, order_type: newType } : item));
    });
  }

  function handleAddProduct() {
    if (!selectedProductId) return;
    const prod = products?.find((p) => p.id === selectedProductId);
    if (!prod) return;

    setCart((prev) => {
      const existingIdx = prev.findIndex(
        (item) => item.product_id === prod.id && (item.order_type || "dine_in") === "dine_in",
      );
      if (existingIdx > -1) {
        return prev.map((item, idx) =>
          idx === existingIdx ? { ...item, qty: item.qty + 1 } : item,
        );
      }
      return [
        ...prev,
        {
          product_id: prod.id,
          name: prod.name,
          price: prod.price,
          qty: 1,
          order_type: "dine_in",
        },
      ];
    });
    setSelectedProductId("");
  }

  async function handleSave() {
    if (!transaction) return;
    if (cart.length === 0) {
      toast.error("Transaksi tidak boleh kosong (minimal 1 menu)");
      return;
    }

    setSaving(true);
    try {
      const finalPaid = paymentMethod === "cash" ? Math.max(paidAmount, grandTotal) : grandTotal;

      const result = await updateTransaction({
        transactionId: transaction.id,
        cart,
        paymentMethod,
        paidAmount: finalPaid,
        discount,
        customerId,
        note: note.trim() || null,
        orderType: currentOrderType,
      });

      toast.success(`Transaksi ${transaction.receipt_no} berhasil dikoreksi!`);
      onSaved?.(result.transaction);
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Gagal mengoreksi transaksi: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto rounded-3xl p-5">
        <DialogHeader>
          <div className="flex items-center justify-between pr-4">
            <div>
              <DialogTitle className="text-base font-bold">
                Koreksi Transaksi {transaction?.receipt_no}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ubah menu, cara bayar, diskon, atau tipe pesanan.
              </p>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="mt-2 text-xs text-muted-foreground">Memuat data nota...</p>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {/* Tipe Pesanan Status Banner */}
            <div className="rounded-xl border border-border bg-muted/40 p-2.5 flex items-center justify-between text-xs">
              <span className="font-semibold text-muted-foreground">Tipe Nota:</span>
              <span
                className={cn(
                  "font-bold px-2 py-0.5 rounded-md",
                  currentOrderType === "take_away"
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    : currentOrderType === "mixed"
                      ? "bg-purple-500/15 text-purple-700 dark:text-purple-400"
                      : "bg-primary/15 text-primary",
                )}
              >
                {currentOrderType === "take_away"
                  ? "Bungkus (Bks)"
                  : currentOrderType === "mixed"
                    ? "Campur (Cpr)"
                    : "Makan di Tempat (Mkn)"}
              </span>
            </div>

            {/* Daftar Menu / Item */}
            <div className="space-y-2">
              <Label className="text-xs font-bold">Rincian Menu / Pesanan</Label>
              <div className="divide-y divide-border rounded-2xl border border-border bg-card p-2.5 space-y-1.5">
                {cart.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    Belum ada menu di transaksi ini.
                  </p>
                ) : (
                  cart.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between pt-2 first:pt-0">
                      <div className="flex-1 pr-2 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-foreground">{item.name}</span>
                          <button
                            type="button"
                            onClick={() => toggleItemOrderType(idx)}
                            className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full font-medium border transition-colors inline-flex items-center gap-1",
                              item.order_type === "take_away"
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/25"
                                : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20",
                            )}
                            title="Klik untuk ubah Makan di Tempat / Bungkus"
                          >
                            {item.order_type === "take_away" ? (
                              <>
                                <ShoppingBag className="h-2.5 w-2.5" />
                                Bungkus
                              </>
                            ) : (
                              <>
                                <Utensils className="h-2.5 w-2.5" />
                                Makan di Tempat
                              </>
                            )}
                          </button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {formatRupiah(item.price)} × {item.qty} ={" "}
                          <span className="font-semibold text-foreground">
                            {formatRupiah(item.price * item.qty)}
                          </span>
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => changeQty(idx, -1)}
                        >
                          {item.qty === 1 ? (
                            <Trash2 className="h-3 w-3 text-destructive" />
                          ) : (
                            <Minus className="h-3 w-3" />
                          )}
                        </Button>
                        <span className="w-5 text-center text-xs font-bold">{item.qty}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => changeQty(idx, 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Tambah Menu Baru ke Nota */}
              <div className="flex gap-2 pt-1">
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="flex-1 rounded-xl border border-input bg-background p-2 text-xs text-foreground"
                >
                  <option value="">+ Tambah menu lain...</option>
                  {products?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({formatRupiah(p.price)})
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddProduct}
                  disabled={!selectedProductId}
                  className="text-xs h-9 px-3"
                >
                  Tambah
                </Button>
              </div>
            </div>

            {/* Pelanggan */}
            <div className="space-y-1">
              <Label className="text-xs font-bold">Pelanggan</Label>
              <select
                value={customerId ?? ""}
                onChange={(e) => setCustomerId(e.target.value || null)}
                className="w-full rounded-xl border border-input bg-background p-2.5 text-xs text-foreground"
              >
                <option value="">Umum / Tanpa Nama</option>
                {customers?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ? `(${c.phone})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Diskon */}
            <div className="space-y-1">
              <Label className="text-xs font-bold">Diskon (Rp)</Label>
              <Input
                inputMode="numeric"
                value={discount ? formatPlain(discount) : ""}
                onChange={(e) => setDiscount(parseNumberInput(e.target.value))}
                placeholder="0"
                className="text-xs"
              />
            </div>

            {/* Metode Pembayaran */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Metode Pembayaran</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={paymentMethod === "cash" ? "default" : "outline"}
                  onClick={() => setPaymentMethod("cash")}
                  className="w-full text-xs h-9 font-semibold"
                >
                  Tunai
                </Button>
                <Button
                  type="button"
                  variant={paymentMethod === "qris" ? "default" : "outline"}
                  onClick={() => setPaymentMethod("qris")}
                  className="w-full text-xs h-9 font-semibold"
                >
                  QRIS
                </Button>
              </div>
            </div>

            {/* Uang Diterima & Kembalian jika Tunai */}
            {paymentMethod === "cash" && (
              <div className="space-y-2 rounded-2xl bg-muted/50 p-3">
                <Label className="text-xs font-semibold">Uang Diterima (Rp)</Label>
                <Input
                  inputMode="numeric"
                  value={paidAmount ? formatPlain(paidAmount) : ""}
                  onChange={(e) => setPaidAmount(parseNumberInput(e.target.value))}
                  placeholder={formatPlain(grandTotal)}
                  className="text-base font-bold"
                />
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {[grandTotal, 10000, 20000, 50000, 100000]
                    .filter((v, i, a) => v >= grandTotal && a.indexOf(v) === i)
                    .map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setPaidAmount(val)}
                        className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium hover:bg-muted"
                      >
                        {formatPlain(val)}
                      </button>
                    ))}
                </div>
                <div className="flex justify-between pt-1 text-xs">
                  <span className="text-muted-foreground">Kembalian:</span>
                  <span className="font-bold text-primary">{formatRupiah(change)}</span>
                </div>
              </div>
            )}

            {/* Catatan */}
            <div className="space-y-1">
              <Label className="text-xs font-bold">Catatan (opsional)</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="mis. koreksi salah pesan menu"
                className="text-xs"
              />
            </div>

            {/* Ringkasan Total Akhir */}
            <div className="space-y-1 rounded-2xl border border-border bg-muted/20 p-3 text-xs">
              {discount > 0 && (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{formatRupiah(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Diskon</span>
                    <span>- {formatRupiah(discount)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-sm font-bold pt-1">
                <span>Total Baru</span>
                <span className="text-primary text-base">{formatRupiah(grandTotal)}</span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="text-xs"
          >
            Batal
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || cart.length === 0}
            className="text-xs font-bold gap-1.5"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Simpan Koreksi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
