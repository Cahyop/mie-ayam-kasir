import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { enqueueUpsert, getUserId } from "@/lib/sync";
import { checkout } from "@/lib/sales";
import { formatRupiah, formatPlain, parseNumberInput, uid } from "@/lib/format";
import type { CartItem, Customer, ReceiptData } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ReceiptDialog } from "@/components/receipt-dialog";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Minus, Plus, Search, Trash2, ShoppingBasket, UserPlus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/kasir")({
  head: () => ({
    meta: [
      { title: "Kasir — POS Mie Ayam" },
      { name: "description", content: "Layar kasir: pilih menu, hitung total, dan bayar." },
    ],
  }),
  component: KasirPage,
});

function KasirPage() {
  const products = useLiveQuery(async () => {
    try {
      const all = await db.products.toArray();
      return all.filter((p) => p.active);
    } catch {
      return [];
    }
  }, []);
  const settings = useLiveQuery(async () => (await db.settings.toArray())[0], []);
  const customers = useLiveQuery(async () => {
    try {
      const all = await db.customers.toArray();
      return all.sort((a, b) => a.name.localeCompare(b.name, "id-ID"));
    } catch {
      return [];
    }
  }, []);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("Semua");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qris">("cash");
  const [paidAmount, setPaidAmount] = useState(0);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [saving, setSaving] = useState(false);

  // Quick Customer Add
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");

  const categories = useMemo(() => {
    const set = new Set<string>("Semua");
    products?.forEach((p) => set.add(p.category));
    return [...set];
  }, [products]);

  const filtered = (products ?? []).filter(
    (p) =>
      (category === "Semua" || p.category === category) &&
      p.name.toLowerCase().includes(search.toLowerCase()),
  );

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const grandTotal = Math.max(0, cartTotal - discount);
  const change = paymentMethod === "cash" ? Math.max(0, paidAmount - grandTotal) : 0;
  const customer = customers?.find((c) => c.id === customerId);

  function addToCart(productId: string, name: string, price: number) {
    setCart((prev) => {
      const existing = prev.find((item) => item.product_id === productId);
      if (existing) {
        return prev.map((item) =>
          item.product_id === productId ? { ...item, qty: item.qty + 1 } : item,
        );
      }
      return [...prev, { product_id: productId, name, price, qty: 1 }];
    });
  }

  function changeQty(productId: string | null, delta: number) {
    setCart((prev) =>
      prev
        .map((item) => (item.product_id === productId ? { ...item, qty: item.qty + delta } : item))
        .filter((item) => item.qty > 0),
    );
  }

  async function handleQuickAddCustomer() {
    if (!quickName.trim()) {
      toast.error("Nama pelanggan wajib diisi");
      return;
    }
    let userId = getUserId();
    if (!userId) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? "anonymous";
    }
    const now = new Date().toISOString();
    const row: Customer = {
      id: uid(),
      user_id: userId,
      name: quickName.trim(),
      phone: quickPhone.trim() || null,
      note: null,
      created_at: now,
      updated_at: now,
    };
    await db.customers.put(row);
    await enqueueUpsert("customers", row);
    setCustomerId(row.id);
    setQuickCustomerOpen(false);
    setQuickName("");
    setQuickPhone("");
    toast.success(`Pelanggan "${row.name}" berhasil ditambahkan`);
  }

  async function pay() {
    if (cart.length === 0) return;
    let finalPaid = paidAmount;
    if (paymentMethod === "cash" && paidAmount < grandTotal) {
      finalPaid = grandTotal;
      setPaidAmount(grandTotal);
    }
    setSaving(true);
    try {
      const result = await checkout({
        cart,
        paymentMethod,
        paidAmount: paymentMethod === "cash" ? Math.max(finalPaid, grandTotal) : grandTotal,
        discount,
        customerId,
        note: null,
      });
      const data: ReceiptData = {
        receiptNo: result.transaction.receipt_no,
        createdAt: result.transaction.created_at,
        storeName: settings?.store_name ?? "Mie Ayam",
        storeAddress: settings?.store_address ?? null,
        storePhone: settings?.store_phone ?? null,
        footer: settings?.receipt_footer ?? "",
        items: result.items.map((item) => ({
          name: item.name,
          qty: item.qty,
          price: item.price,
          total: item.total,
        })),
        subtotal: result.transaction.subtotal,
        discount: result.transaction.discount,
        total: result.transaction.total,
        paymentMethod: result.transaction.payment_method,
        paidAmount: result.transaction.paid_amount,
        changeAmount: result.transaction.change_amount,
        customerName: customer?.name ?? null,
      };
      setReceipt(data);
      setCart([]);
      setCartOpen(false);
      setDiscount(0);
      setPaidAmount(0);
      setCustomerId(null);
    } catch (error) {
      console.error(error);
      toast.error("Gagal memproses pembayaran");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari menu…"
          className="pl-9"
        />
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold",
              category === cat
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {filtered.map((product) => (
          <button
            key={product.id}
            onClick={() => addToCart(product.id, product.name, product.price)}
            className="flex flex-col items-start rounded-2xl border border-border bg-card p-3 text-left shadow-sm active:scale-[0.98] transition-transform"
          >
            <span className="text-sm font-semibold leading-snug text-foreground">
              {product.name}
            </span>
            <span className="mt-1 text-sm font-bold text-primary">
              {formatRupiah(product.price)}
            </span>
            <span className="mt-1 text-[11px] text-muted-foreground">
              {product.track_stock ? `Stok: ${product.stock}` : "Tanpa stok"}
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-2 py-10 text-center text-sm text-muted-foreground">
            Menu tidak ditemukan. Tambahkan di tab Produk.
          </p>
        )}
      </div>

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-[64px] z-20 mx-auto max-w-3xl px-4 pb-[env(safe-area-inset-bottom)]">
          <Button
            onClick={() => setCartOpen(true)}
            className="h-13 w-full rounded-2xl py-4 text-base shadow-lg"
          >
            <ShoppingBasket className="mr-2 h-5 w-5" />
            {cart.reduce((n, i) => n + i.qty, 0)} item · {formatRupiah(grandTotal)}
          </Button>
        </div>
      )}

      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-3xl px-4">
          <SheetHeader>
            <SheetTitle>Keranjang</SheetTitle>
          </SheetHeader>

          <div className="space-y-2 pb-2">
            {cart.map((item) => (
              <div
                key={item.product_id ?? item.name}
                className="flex items-center justify-between rounded-xl border border-border bg-muted/40 p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{formatRupiah(item.price)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => changeQty(item.product_id, -1)}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="w-6 text-center text-sm font-bold">{item.qty}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => changeQty(item.product_id, 1)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <button
                    onClick={() =>
                      setCart((prev) => prev.filter((c) => c.product_id !== item.product_id))
                    }
                    className="ml-1 text-muted-foreground"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3 border-t border-border pt-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPaymentMethod("cash")}
                className={cn(
                  "rounded-xl border py-2.5 text-sm font-semibold",
                  paymentMethod === "cash"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card",
                )}
              >
                Tunai
              </button>
              <button
                onClick={() => setPaymentMethod("qris")}
                className={cn(
                  "rounded-xl border py-2.5 text-sm font-semibold",
                  paymentMethod === "qris"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card",
                )}
              >
                QRIS
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Diskon (Rp)</Label>
                <Input
                  inputMode="numeric"
                  value={discount ? formatPlain(discount) : ""}
                  onChange={(e) => setDiscount(parseNumberInput(e.target.value))}
                  placeholder="0"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Pelanggan</Label>
                  <button
                    type="button"
                    onClick={() => setQuickCustomerOpen(true)}
                    className="flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:underline"
                  >
                    <UserPlus className="h-3 w-3" /> Baru
                  </button>
                </div>
                <select
                  value={customerId ?? ""}
                  onChange={(e) => setCustomerId(e.target.value || null)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">— Tanpa pelanggan —</option>
                  {customers?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="text-lg font-extrabold">{formatRupiah(grandTotal)}</span>
            </div>

            {paymentMethod === "cash" && (
              <div className="space-y-2">
                <Label className="text-xs">Uang diterima</Label>
                <Input
                  inputMode="numeric"
                  value={paidAmount ? formatPlain(paidAmount) : ""}
                  onChange={(e) => setPaidAmount(parseNumberInput(e.target.value))}
                  placeholder="0"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setPaidAmount(grandTotal)}
                  >
                    Pas
                  </Button>
                  {[20000, 50000, 100000].map((amount) => (
                    <Button
                      key={amount}
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setPaidAmount(amount)}
                    >
                      {formatPlain(amount)}
                    </Button>
                  ))}
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Kembalian</span>
                  <span className="font-bold">{formatRupiah(change)}</span>
                </div>
              </div>
            )}

            <Button
              onClick={pay}
              disabled={saving || cart.length === 0}
              className="w-full py-6 text-base font-bold"
            >
              {saving ? "Menyimpan…" : `Bayar ${formatRupiah(grandTotal)}`}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Quick Add Customer Dialog */}
      <Dialog open={quickCustomerOpen} onOpenChange={setQuickCustomerOpen}>
        <DialogContent className="max-w-sm rounded-2xl p-5">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold">Tambah Pelanggan Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="space-y-1">
              <Label className="text-xs">Nama Pelanggan *</Label>
              <Input
                placeholder="mis. Mas Joko / Meja 3"
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nomor WhatsApp (opsional)</Label>
              <Input
                placeholder="mis. 08123456789"
                value={quickPhone}
                onChange={(e) => setQuickPhone(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setQuickCustomerOpen(false)}>
              Batal
            </Button>
            <Button size="sm" onClick={handleQuickAddCustomer}>
              Simpan &amp; Pilih
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceiptDialog
        receipt={receipt}
        onClose={() => setReceipt(null)}
        paperWidth={settings?.paper_width ?? "58"}
      />
    </div>
  );
}
