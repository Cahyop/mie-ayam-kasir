import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { enqueueUpsert, getUserId } from "@/lib/sync";
import { checkout, computeTransactionOrderType } from "@/lib/sales";
import { formatRupiah, formatPlain, parseNumberInput, uid } from "@/lib/format";
import { getActiveShift, openShift } from "@/lib/shift";
import type {
  CartItem,
  Customer,
  DraftOrder,
  ItemOrderType,
  OrderType,
  ReceiptData,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { ClosingDialog } from "@/components/closing-dialog";
import { DraftOrdersListDialog, SaveDraftDialog } from "@/components/draft-orders-dialog";
import { deleteDraftOrder, ensureDraftOrdersRestored, saveDraftOrder } from "@/lib/drafts";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  Minus,
  Plus,
  Search,
  Trash2,
  ShoppingBasket,
  UserPlus,
  Store,
  SunMedium,
  Clock,
  Loader2,
  Utensils,
  ShoppingBag,
  Bookmark,
  ClipboardList,
} from "lucide-react";
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
  const activeShift = useLiveQuery(() => getActiveShift(), []);
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

  // Shift opening state
  const [initialCashInput, setInitialCashInput] = useState<number>(100000);
  const [openShiftNotes, setOpenShiftNotes] = useState<string>("");
  const [openingShift, setOpeningShift] = useState(false);
  const [closingDialogOpen, setClosingDialogOpen] = useState(false);

  // Cashier & Cart State
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("Semua");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "qris">("cash");
  const [orderType, setOrderType] = useState<OrderType>("dine_in");
  const [paidAmount, setPaidAmount] = useState(0);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [saving, setSaving] = useState(false);

  // Draft / Pending Orders State
  useEffect(() => {
    void ensureDraftOrdersRestored();
  }, []);

  const draftOrders =
    useLiveQuery(() => db.draft_orders.orderBy("updated_at").reverse().toArray(), []) ?? [];
  const [draftListOpen, setDraftListOpen] = useState(false);
  const [saveDraftOpen, setSaveDraftOpen] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [tableNo, setTableNo] = useState<string>("");

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

  async function handleOpenShift(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setOpeningShift(true);
    try {
      await openShift(initialCashInput, openShiftNotes.trim());
      toast.success("Kasir berhasil dibuka! Selamat berjualan.");
    } catch {
      toast.error("Gagal membuka kasir");
    } finally {
      setOpeningShift(false);
    }
  }

  function addToCart(productId: string, name: string, price: number) {
    const itemType: ItemOrderType = orderType === "take_away" ? "take_away" : "dine_in";
    setCart((prev) => {
      const existingIdx = prev.findIndex(
        (item) => item.product_id === productId && (item.order_type || "dine_in") === itemType,
      );
      if (existingIdx > -1) {
        return prev.map((item, idx) =>
          idx === existingIdx ? { ...item, qty: item.qty + 1 } : item,
        );
      }
      return [...prev, { product_id: productId, name, price, qty: 1, order_type: itemType }];
    });
  }

  function changeQty(
    productId: string | null,
    delta: number,
    itemOrderType: ItemOrderType = "dine_in",
  ) {
    setCart((prev) =>
      prev
        .map((item) =>
          item.product_id === productId && (item.order_type || "dine_in") === itemOrderType
            ? { ...item, qty: item.qty + delta }
            : item,
        )
        .filter((item) => item.qty > 0),
    );
  }

  function toggleItemOrderType(itemIndex: number) {
    setCart((prev) => {
      const target = prev[itemIndex];
      if (!target) return prev;
      const currentType = target.order_type || "dine_in";
      const newType: ItemOrderType = currentType === "take_away" ? "dine_in" : "take_away";

      // If item with newType already exists in cart, merge quantities
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

  function handleHeaderOrderTypeChange(type: OrderType) {
    setOrderType(type);
    setCart((prev) => {
      if (prev.length === 0) return prev;
      const targetType: ItemOrderType = type === "take_away" ? "take_away" : "dine_in";
      const merged: CartItem[] = [];
      for (const item of prev) {
        const existing = merged.find((m) => m.product_id === item.product_id);
        if (existing) {
          existing.qty += item.qty;
        } else {
          merged.push({ ...item, order_type: targetType });
        }
      }
      return merged;
    });
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
      const computedType = computeTransactionOrderType(cart);
      const result = await checkout({
        cart,
        paymentMethod,
        paidAmount: paymentMethod === "cash" ? Math.max(finalPaid, grandTotal) : grandTotal,
        discount,
        customerId,
        note: null,
        orderType: computedType,
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
          orderType: item.order_type,
        })),
        subtotal: result.transaction.subtotal,
        discount: result.transaction.discount,
        total: result.transaction.total,
        paymentMethod: result.transaction.payment_method,
        paidAmount: result.transaction.paid_amount,
        changeAmount: result.transaction.change_amount,
        customerName: customer?.name ?? null,
        orderType: result.transaction.order_type,
      };
      setReceipt(data);

      // Jika transaksi berasal dari draft, bersihkan draft tersebut
      if (editingDraftId) {
        await deleteDraftOrder(editingDraftId);
        setEditingDraftId(null);
        setTableNo("");
      }

      setCart([]);
      setCartOpen(false);
      setDiscount(0);
      setPaidAmount(0);
      setCustomerId(null);
      setOrderType("dine_in");
    } catch (error) {
      console.error(error);
      toast.error("Gagal memproses pembayaran");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDraft(tblNo: string, draftNote: string) {
    if (cart.length === 0) return;
    try {
      const saved = await saveDraftOrder({
        id: editingDraftId,
        tableNo: tblNo,
        customerName: customer?.name ?? null,
        customerId,
        note: draftNote || null,
        items: cart,
        orderType: computeTransactionOrderType(cart),
        discount,
      });
      setTableNo("");
      setEditingDraftId(null);
      setCart([]);
      setDiscount(0);
      setPaidAmount(0);
      setCustomerId(null);
      setCartOpen(false);
      setOrderType("dine_in");
      toast.success(`Pesanan "${saved.table_no || "Draft"}" berhasil disimpan!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Gagal menyimpan pesanan: ${msg}`);
    }
  }

  function handleOpenDraft(draft: DraftOrder) {
    setCart(draft.items);
    setEditingDraftId(draft.id);
    setTableNo(draft.table_no || "");
    setCustomerId(draft.customer_id);
    setDiscount(draft.discount || 0);
    setOrderType(draft.order_type);
    setCartOpen(true);
    toast.info(`Membuka pesanan "${draft.table_no || "Draft"}"`);
  }

  function handlePrintBill(draft: DraftOrder) {
    const sub = draft.items.reduce((s, it) => s + it.price * it.qty, 0);
    const disc = draft.discount || 0;
    const tot = Math.max(0, sub - disc);
    const data: ReceiptData = {
      receiptNo: draft.table_no || "DRAFT",
      createdAt: draft.created_at,
      storeName: settings?.store_name ?? "Mie Ayam",
      storeAddress: settings?.store_address ?? null,
      storePhone: settings?.store_phone ?? null,
      footer: settings?.receipt_footer ?? "",
      items: draft.items.map((it) => ({
        name: it.name,
        qty: it.qty,
        price: it.price,
        total: it.price * it.qty,
        orderType: it.order_type,
      })),
      subtotal: sub,
      discount: disc,
      total: tot,
      paymentMethod: "cash",
      paidAmount: 0,
      changeAmount: 0,
      customerName: draft.customer_name ?? null,
      orderType: draft.order_type,
      isDraft: true,
      tableNo: draft.table_no,
    };
    setReceipt(data);
  }

  // Loading state when reading active shift from db
  if (activeShift === undefined) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-2 text-xs text-muted-foreground">Memuat sesi kasir...</p>
      </div>
    );
  }

  // Kasir Belum Dibuka View
  if (!activeShift || activeShift.status !== "open") {
    return (
      <div className="mx-auto max-w-md py-6 px-1">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Store className="h-8 w-8" />
          </div>

          <h2 className="text-lg font-bold text-foreground">Buka Kasir Hari Ini</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Masukkan modal awal uang kembalian di laci kasir untuk mulai melayani transaksi.
          </p>

          <form onSubmit={handleOpenShift} className="mt-6 space-y-4 text-left">
            <div className="space-y-1.5">
              <Label htmlFor="modal-kasir" className="text-xs font-semibold">
                Modal Awal Kembalian (Rp)
              </Label>
              <Input
                id="modal-kasir"
                inputMode="numeric"
                autoFocus
                value={initialCashInput ? formatPlain(initialCashInput) : ""}
                onChange={(e) => setInitialCashInput(parseNumberInput(e.target.value))}
                placeholder="100.000"
                className="h-12 text-lg font-bold text-center"
              />

              {/* Quick denomination chips */}
              <div className="flex gap-2 pt-1">
                {[50000, 100000, 200000].map((nominal) => (
                  <button
                    key={nominal}
                    type="button"
                    onClick={() => setInitialCashInput(nominal)}
                    className="flex-1 rounded-xl border border-border bg-muted/40 py-1.5 text-xs font-medium hover:bg-muted active:scale-95 transition-transform"
                  >
                    {nominal / 1000}rb
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setInitialCashInput(0)}
                  className="rounded-xl border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  Rp 0
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="modal-note" className="text-xs font-semibold">
                Catatan Pembukaan (opsional)
              </Label>
              <Input
                id="modal-note"
                value={openShiftNotes}
                onChange={(e) => setOpenShiftNotes(e.target.value)}
                placeholder="mis. uang pecahan 5rb & 10rb"
                className="text-xs h-10"
              />
            </div>

            <Button
              type="submit"
              disabled={openingShift}
              className="w-full h-12 rounded-xl text-sm font-bold shadow-md"
            >
              {openingShift ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <SunMedium className="mr-2 h-4 w-4" />
              )}
              Buka Kasir Sekarang
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // Active Kasir View
  return (
    <div>
      {/* Active Shift Header Bar */}
      <div className="mb-3 flex items-center justify-between rounded-2xl bg-card border border-border px-3 py-2 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <div className="text-xs leading-tight">
            <span className="font-bold text-foreground">Kasir Buka</span>
            <span className="text-muted-foreground ml-1.5 text-[11px]">
              Modal:{" "}
              <strong className="text-foreground">{formatRupiah(activeShift.initial_cash)}</strong>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDraftListOpen(true)}
            className="h-7 text-xs font-semibold px-2.5 gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            <span>Pesanan</span>
            {draftOrders.length > 0 && (
              <Badge className="h-4 px-1.5 text-[10px] bg-amber-600 text-white hover:bg-amber-600">
                {draftOrders.length}
              </Badge>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setClosingDialogOpen(true)}
            className="h-7 text-xs font-semibold text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive px-2.5 gap-1"
          >
            <Clock className="h-3 w-3" />
            Tutup Kasir
          </Button>
        </div>
      </div>

      {/* Status Bar Jika Sedang Mengedit Draft Meja */}
      {editingDraftId && (
        <div className="mb-3 flex items-center justify-between rounded-2xl bg-amber-500/15 border border-amber-500/30 px-3 py-2 text-xs shadow-xs">
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0" />
            <span className="font-semibold text-amber-900 dark:text-amber-300">
              Mengedit: <strong>{tableNo || "Pesanan Aktif"}</strong>
              {customer ? ` (${customer.name})` : ""}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCart([]);
              setEditingDraftId(null);
              setTableNo("");
              toast.info("Keluar dari edit pesanan meja");
            }}
            className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
          >
            Batal / Buat Baru
          </Button>
        </div>
      )}

      {/* Tipe Pesanan Kasir (Default: Makan di Tempat) */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          variant={orderType === "dine_in" ? "default" : "outline"}
          onClick={() => setOrderType("dine_in")}
          className="h-8 gap-1.5 text-xs font-semibold"
        >
          <Utensils className="h-3.5 w-3.5" />
          Makan di Tempat
        </Button>
        <Button
          type="button"
          size="sm"
          variant={orderType === "take_away" ? "default" : "outline"}
          onClick={() => setOrderType("take_away")}
          className="h-8 gap-1.5 text-xs font-semibold"
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          Bungkus
        </Button>
      </div>

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

          <div className="mt-3 divide-y divide-border">
            {cart.map((item, idx) => (
              <div
                key={`${item.product_id ?? item.name}-${item.order_type || "dine_in"}`}
                className="flex items-center justify-between py-2.5"
              >
                <div className="flex-1 pr-2 space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-semibold">{item.name}</p>
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
                  <p className="text-xs text-muted-foreground">{formatRupiah(item.price)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => changeQty(item.product_id, -1, item.order_type || "dine_in")}
                  >
                    {item.qty === 1 ? (
                      <Trash2 className="h-3.5 w-3.5" />
                    ) : (
                      <Minus className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <span className="w-6 text-center text-sm font-bold">{item.qty}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => changeQty(item.product_id, 1, item.order_type || "dine_in")}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-3 border-t border-border pt-4">
            {/* Pilihan Mode Transaksi Utama */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Tipe Pesanan Utama</Label>
                <span className="text-[11px] text-muted-foreground">
                  Status:{" "}
                  <strong className="text-foreground">
                    {computeTransactionOrderType(cart) === "mixed"
                      ? "Campur (Makan & Bungkus)"
                      : computeTransactionOrderType(cart) === "take_away"
                        ? "Bungkus"
                        : "Makan di Tempat"}
                  </strong>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={orderType === "dine_in" ? "default" : "outline"}
                  onClick={() => handleHeaderOrderTypeChange("dine_in")}
                  className="w-full gap-1.5 text-xs font-semibold"
                >
                  <Utensils className="h-3.5 w-3.5" />
                  Makan di Tempat
                </Button>
                <Button
                  type="button"
                  variant={orderType === "take_away" ? "default" : "outline"}
                  onClick={() => handleHeaderOrderTypeChange("take_away")}
                  className="w-full gap-1.5 text-xs font-semibold"
                >
                  <ShoppingBag className="h-3.5 w-3.5" />
                  Bungkus
                </Button>
              </div>
            </div>

            {/* Customer Picker with Quick Add Button */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Pelanggan</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px] text-primary"
                  onClick={() => setQuickCustomerOpen(true)}
                >
                  <UserPlus className="h-3 w-3" />+ Baru
                </Button>
              </div>
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

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Diskon (Rp)</Label>
              <Input
                inputMode="numeric"
                value={discount ? formatPlain(discount) : ""}
                onChange={(e) => setDiscount(parseNumberInput(e.target.value))}
                placeholder="0"
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Metode Pembayaran</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={paymentMethod === "cash" ? "default" : "outline"}
                  onClick={() => setPaymentMethod("cash")}
                  className="w-full"
                >
                  Tunai
                </Button>
                <Button
                  type="button"
                  variant={paymentMethod === "qris" ? "default" : "outline"}
                  onClick={() => setPaymentMethod("qris")}
                  className="w-full"
                >
                  QRIS
                </Button>
              </div>
            </div>

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

            <div className="space-y-1 pt-2">
              {discount > 0 && (
                <>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{formatRupiah(cartTotal)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Diskon</span>
                    <span>- {formatRupiah(discount)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-base font-bold">
                <span>Total Bayar</span>
                <span className="text-primary">{formatRupiah(grandTotal)}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSaveDraftOpen(true)}
                className="h-12 flex-1 border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 gap-1.5 text-xs font-semibold"
              >
                <Bookmark className="h-4 w-4" />
                {editingDraftId ? "Perbarui Pesanan" : "Simpan Pesanan"}
              </Button>
              <Button
                type="button"
                onClick={pay}
                disabled={saving}
                className="h-12 flex-1 text-sm font-bold gap-1.5"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Bayar {formatRupiah(grandTotal)}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Save Draft / Meja Dialog */}
      <SaveDraftDialog
        open={saveDraftOpen}
        onOpenChange={setSaveDraftOpen}
        cart={cart}
        defaultTableNo={tableNo}
        isEditing={Boolean(editingDraftId)}
        onSave={handleSaveDraft}
      />

      {/* List Active Drafts Dialog */}
      <DraftOrdersListDialog
        open={draftListOpen}
        onOpenChange={setDraftListOpen}
        drafts={draftOrders}
        onOpenDraft={handleOpenDraft}
        onPrintBill={handlePrintBill}
      />

      {/* Quick Add Customer Dialog */}
      <Dialog open={quickCustomerOpen} onOpenChange={setQuickCustomerOpen}>
        <DialogContent className="max-w-sm rounded-2xl p-4">
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

      {/* Thermal Receipt Dialog */}
      <ReceiptDialog
        receipt={receipt}
        onClose={() => setReceipt(null)}
        paperWidth={settings?.paper_width ?? "58"}
      />

      {/* Shift Closing Dialog */}
      <ClosingDialog
        open={closingDialogOpen}
        onOpenChange={setClosingDialogOpen}
        shift={activeShift}
        storeName={settings?.store_name ?? "Mie Ayam"}
        storePhone={settings?.store_phone}
        paperWidth={settings?.paper_width ?? "58"}
        onClosed={() => {
          setClosingDialogOpen(false);
        }}
      />
    </div>
  );
}
