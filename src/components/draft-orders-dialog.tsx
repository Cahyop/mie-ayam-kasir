import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatPlain, formatRupiah } from "@/lib/format";
import { formatTimeAgo, deleteDraftOrder } from "@/lib/drafts";
import type { CartItem, DraftOrder } from "@/lib/types";
import { toast } from "sonner";
import {
  Bookmark,
  Clock,
  Printer,
  Trash2,
  Utensils,
  ShoppingBag,
  ArrowRight,
  ClipboardList,
} from "lucide-react";

export type SaveDraftDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cart: CartItem[];
  defaultTableNo?: string;
  defaultNote?: string;
  isEditing?: boolean;
  onSave: (tableNo: string, note: string) => Promise<void>;
};

const QUICK_TABLES = [
  "Meja 1",
  "Meja 2",
  "Meja 3",
  "Meja 4",
  "Meja 5",
  "Meja 6",
  "Meja 7",
  "Meja 8",
  "Bungkus",
];

export function SaveDraftDialog({
  open,
  onOpenChange,
  cart,
  defaultTableNo = "",
  defaultNote = "",
  isEditing = false,
  onSave,
}: SaveDraftDialogProps) {
  const [tableNo, setTableNo] = useState(defaultTableNo);
  const [note, setNote] = useState(defaultNote);
  const [submitting, setSubmitting] = useState(false);

  // Sync state when dialog opens
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setTableNo(defaultTableNo);
      setNote(defaultNote);
    }
    onOpenChange(nextOpen);
  };

  const totalAmount = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tableNo.trim()) {
      toast.error("Nomor meja atau nama penanda wajib diisi");
      return;
    }
    setSubmitting(true);
    try {
      await onSave(tableNo.trim(), note.trim());
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Gagal menyimpan draft: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md rounded-3xl p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Bookmark className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            {isEditing ? "Perbarui Pesanan Aktif" : "Simpan Pesanan (Bayar Belakang)"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Summary Box */}
          <div className="rounded-2xl border border-border bg-muted/40 p-3 space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Pesanan:</span>
              <strong className="text-foreground">{totalQty} item</strong>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Total Sementara:</span>
              <span className="font-bold text-primary">{formatRupiah(totalAmount)}</span>
            </div>
          </div>

          {/* Quick Table Selection */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Pilih Cepat Meja / Penanda:</Label>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_TABLES.map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setTableNo(t)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${
                    tableNo === t
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-foreground hover:bg-muted"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Table / Label Input */}
          <div className="space-y-1">
            <Label htmlFor="table-input" className="text-xs font-semibold">
              Nomor Meja / Keterangan Penanda <span className="text-destructive">*</span>
            </Label>
            <Input
              id="table-input"
              value={tableNo}
              onChange={(e) => setTableNo(e.target.value)}
              placeholder="Contoh: Meja 3, Meja Depan, dsb."
              className="text-xs"
              autoFocus
            />
          </div>

          {/* Optional Note */}
          <div className="space-y-1">
            <Label htmlFor="note-input" className="text-xs font-semibold">
              Catatan Khusus (Opsional)
            </Label>
            <Input
              id="note-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Contoh: Kuah dipisah, pedas level 3"
              className="text-xs"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              Batal
            </Button>
            <Button type="submit" disabled={submitting} className="text-xs gap-1.5 font-semibold">
              <Bookmark className="h-3.5 w-3.5" />
              {isEditing ? "Simpan Perubahan" : "Simpan Pesanan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type DraftOrdersListDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drafts: DraftOrder[];
  onOpenDraft: (draft: DraftOrder) => void;
  onPrintBill?: (draft: DraftOrder) => void;
};

export function DraftOrdersListDialog({
  open,
  onOpenChange,
  drafts,
  onOpenDraft,
  onPrintBill,
}: DraftOrdersListDialogProps) {
  const [deleteTarget, setDeleteTarget] = useState<DraftOrder | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDraftOrder(deleteTarget.id);
      toast.success(`Pesanan ${deleteTarget.table_no || "Draft"} berhasil dibatalkan`);
      setDeleteTarget(null);
    } catch {
      toast.error("Gagal menghapus pesanan");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto rounded-3xl p-5">
          <DialogHeader>
            <div className="flex items-center justify-between pr-4">
              <DialogTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-5 w-5 text-primary" />
                Pesanan Aktif (Belum Bayar)
              </DialogTitle>
              <Badge variant="secondary" className="font-semibold text-xs">
                {drafts.length} Meja
              </Badge>
            </div>
          </DialogHeader>

          <div className="mt-2 space-y-3">
            {drafts.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground space-y-2">
                <ClipboardList className="mx-auto h-10 w-10 opacity-30" />
                <p className="text-sm font-semibold">Tidak ada pesanan aktif</p>
                <p className="text-xs max-w-xs mx-auto">
                  Saat pelanggan makan di tempat dan bayar nanti, gunakan tombol{" "}
                  <strong>Simpan Pesanan</strong> di keranjang kasir.
                </p>
              </div>
            ) : (
              drafts.map((draft) => {
                const total = draft.items.reduce((sum, it) => sum + it.price * it.qty, 0);
                const totalQty = draft.items.reduce((sum, it) => sum + it.qty, 0);

                return (
                  <div
                    key={draft.id}
                    className="rounded-2xl border border-border bg-card p-3.5 shadow-xs space-y-2.5 transition-all hover:border-primary/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-foreground">
                            {draft.table_no || "Tanpa Meja"}
                          </span>
                          {draft.customer_name && (
                            <span className="text-xs text-muted-foreground">
                              · {draft.customer_name}
                            </span>
                          )}
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 gap-1 ${
                              draft.order_type === "take_away"
                                ? "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10"
                                : draft.order_type === "mixed"
                                  ? "border-purple-500/40 text-purple-700 dark:text-purple-400 bg-purple-500/10"
                                  : "border-primary/30 text-primary bg-primary/10"
                            }`}
                          >
                            {draft.order_type === "take_away" ? (
                              <>
                                <ShoppingBag className="h-2.5 w-2.5" />
                                Bungkus
                              </>
                            ) : draft.order_type === "mixed" ? (
                              "Campur"
                            ) : (
                              <>
                                <Utensils className="h-2.5 w-2.5" />
                                Makan di Tempat
                              </>
                            )}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>{formatTimeAgo(draft.updated_at || draft.created_at)}</span>
                          {draft.note && <span>· Catatan: &quot;{draft.note}&quot;</span>}
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-bold text-sm text-primary">
                          {formatRupiah(total)}
                        </span>
                        <p className="text-[10px] text-muted-foreground">{totalQty} item</p>
                      </div>
                    </div>

                    {/* Preview Menu Ringkas */}
                    <div className="rounded-xl bg-muted/40 p-2 text-xs text-muted-foreground space-y-0.5">
                      {draft.items.map((it, i) => (
                        <div key={i} className="flex justify-between">
                          <span>
                            {it.name} {it.order_type === "take_away" ? "(Bks)" : ""}
                          </span>
                          <span>
                            {it.qty} × {formatPlain(it.price)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(draft)}
                        className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive px-2 text-xs"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Batal
                      </Button>

                      <div className="flex items-center gap-1.5">
                        {onPrintBill && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onPrintBill(draft)}
                            className="h-8 text-xs px-2.5 gap-1"
                            title="Cetak Bill Sementara untuk Pelanggan"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            Bill
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            onOpenDraft(draft);
                            onOpenChange(false);
                          }}
                          className="h-8 text-xs px-3 font-semibold gap-1.5"
                        >
                          Buka / Bayar
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(op) => !op && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-3xl max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">Batalkan Pesanan Ini?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Pesanan <strong>{deleteTarget?.table_no || "Draft"}</strong> akan dihapus dan tidak
              akan dicatat sebagai penjualan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Kembali</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs"
            >
              Ya, Batalkan Pesanan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
