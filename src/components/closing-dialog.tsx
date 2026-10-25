import { useEffect, useState } from "react";
import {
  calculateShiftSummary,
  closeShift,
  buildShiftReceiptLines,
  buildShiftWaText,
} from "@/lib/shift";
import { formatPlain, formatRupiah, parseNumberInput } from "@/lib/format";
import { waHref } from "@/lib/receipt";
import {
  bluetoothPrintingSupported,
  isPrinterConnected,
  printLinesViaBluetooth,
  subscribePrinterStatus,
} from "@/lib/printer";
import type { RegisterShift, ShiftSummary } from "@/lib/types";
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
import { CheckCircle2, Loader2, MessageSquare, Printer, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface ClosingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: RegisterShift | null;
  storeName?: string;
  storePhone?: string | null;
  paperWidth?: "58" | "80";
  onClosed: () => void;
}

export function ClosingDialog({
  open,
  onOpenChange,
  shift,
  storeName = "Mie Ayam",
  storePhone,
  paperWidth = "58",
  onClosed,
}: ClosingDialogProps) {
  const [actualCash, setActualCash] = useState<number>(0);
  const [closingNotes, setClosingNotes] = useState<string>("");
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [closing, setClosing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printerConnected, setPrinterConnected] = useState(isPrinterConnected());
  const [waPhone, setWaPhone] = useState(storePhone || "");
  const [showPhoneInput, setShowPhoneInput] = useState(false);
  const [isShiftFinished, setIsShiftFinished] = useState(false);

  useEffect(() => {
    return subscribePrinterStatus((connected) => {
      setPrinterConnected(connected);
    });
  }, []);

  useEffect(() => {
    if (storePhone) setWaPhone(storePhone);
  }, [storePhone]);

  useEffect(() => {
    if (open && shift) {
      setIsShiftFinished(false);
      setLoadingSummary(true);
      calculateShiftSummary(shift, 0)
        .then((s) => {
          setSummary(s);
          setActualCash(s.expectedCash);
        })
        .finally(() => setLoadingSummary(false));
    }
  }, [open, shift]);

  const difference = summary ? actualCash - summary.expectedCash : 0;
  const currentSummary: ShiftSummary | null = summary
    ? { ...summary, actualCash, difference }
    : null;

  if (!shift) return null;

  async function handlePrintBluetooth() {
    if (!currentSummary) return;
    setPrinting(true);
    try {
      const lines = buildShiftReceiptLines(currentSummary, storeName, paperWidth);
      const deviceName = await printLinesViaBluetooth(lines, paperWidth);
      toast.success(`Laporan closing dicetak ke ${deviceName}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes("user cancelled")) {
        toast.error(`Gagal mencetak Bluetooth: ${msg}`);
      }
    } finally {
      setPrinting(false);
    }
  }

  function handleBrowserPrint() {
    if (!currentSummary) return;
    const lines = buildShiftReceiptLines(currentSummary, storeName, paperWidth);
    const text = lines.map((l) => l.text).join("\n");
    const widthMm = paperWidth === "58" ? 58 : 80;

    const win = window.open("", "_blank", "width=420,height=640");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>Closing Kasir</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 2mm; }
  body { margin: 0; font-family: "Courier New", monospace; font-size: ${paperWidth === "58" ? 12 : 13}px; font-weight: 600; white-space: pre; width: ${widthMm - 6}mm; }
</style></head><body>${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string)}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  function handleSendWhatsApp() {
    if (!currentSummary) return;
    const text = buildShiftWaText(currentSummary, storeName);
    const href = waHref(text, waPhone.trim() || undefined);
    window.open(href, "_blank", "noopener,noreferrer");
  }

  async function handleConfirmClose() {
    if (!shift || !summary) return;
    setClosing(true);
    try {
      await closeShift(shift, actualCash, closingNotes.trim());
      setIsShiftFinished(true);
      toast.success("Kasir hari ini berhasil ditutup!");
      onClosed();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Gagal menutup kasir: ${msg}`);
    } finally {
      setClosing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto rounded-3xl p-5">
        <DialogHeader>
          <DialogTitle className="text-center text-base font-bold">
            {isShiftFinished ? "Kasir Resmi Ditutup" : "Tutup Kasir (Closing)"}
          </DialogTitle>
        </DialogHeader>

        {loadingSummary && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-2 text-xs text-muted-foreground">Menghitung rekap kas...</p>
          </div>
        )}

        {!loadingSummary && summary && (
          <div className="space-y-4">
            {/* Shift Time Badge */}
            <div className="rounded-2xl bg-muted/60 p-3 text-xs">
              <div className="flex justify-between font-medium">
                <span className="text-muted-foreground">Buka Kasir:</span>
                <span className="font-semibold">
                  {new Date(summary.openedAt).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="flex justify-between font-medium mt-1">
                <span className="text-muted-foreground">Tutup Kasir:</span>
                <span className="font-semibold">
                  {new Date().toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </div>

            {/* Sales & Cash Breakdown */}
            <div className="rounded-2xl border border-border bg-card p-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Modal Awal:</span>
                <span className="font-semibold">{formatRupiah(summary.initialCash)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Penjualan Tunai ({summary.cashTxCount} nota):
                </span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  +{formatRupiah(summary.cashSales)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Penjualan QRIS ({summary.qrisTxCount} nota):
                </span>
                <span className="font-semibold text-primary">
                  +{formatRupiah(summary.qrisSales)}
                </span>
              </div>

              <div className="border-t border-dashed border-border pt-1.5 flex justify-between font-bold">
                <span>Total Omset ({summary.totalTxCount} nota):</span>
                <span>{formatRupiah(summary.totalSales)}</span>
              </div>

              {(summary.cashIn > 0 || summary.cashOut > 0) && (
                <div className="border-t border-border pt-1.5 space-y-1">
                  {summary.cashIn > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Kas Masuk Lain:</span>
                      <span className="font-semibold text-emerald-600">
                        +{formatRupiah(summary.cashIn)}
                      </span>
                    </div>
                  )}
                  {summary.cashOut > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Kas Keluar:</span>
                      <span className="font-semibold text-destructive">
                        -{formatRupiah(summary.cashOut)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Expected cash in drawer */}
              <div className="rounded-xl bg-primary/10 p-2.5 mt-2 flex justify-between items-center">
                <div>
                  <p className="text-[11px] font-semibold text-primary">
                    Uang Kas di Laci (Sistem):
                  </p>
                  <p className="text-[10px] text-muted-foreground">Modal + Tunai + Kas Bersih</p>
                </div>
                <p className="text-base font-extrabold text-primary">
                  {formatRupiah(summary.expectedCash)}
                </p>
              </div>
            </div>

            {/* Actual Physical Cash Input */}
            {!isShiftFinished ? (
              <div className="space-y-2 rounded-2xl border border-border bg-card p-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="actual-cash" className="text-xs font-bold">
                    Hitung Uang Fisik di Laci:
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] text-primary px-2"
                    onClick={() => setActualCash(summary.expectedCash)}
                  >
                    Uang Pas
                  </Button>
                </div>
                <Input
                  id="actual-cash"
                  inputMode="numeric"
                  className="font-bold text-base h-11"
                  value={actualCash ? formatPlain(actualCash) : ""}
                  onChange={(e) => setActualCash(parseNumberInput(e.target.value))}
                  placeholder="0"
                />

                {/* Live Difference Badge */}
                <div
                  className={`rounded-xl p-2.5 flex items-center justify-between text-xs font-bold ${
                    difference === 0
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : difference > 0
                        ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                        : "bg-destructive/15 text-destructive"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {difference === 0 ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                    <span>
                      {difference === 0
                        ? "Uang Pas (Sesuai Sistem)"
                        : difference > 0
                          ? "Uang Fisik Lebih"
                          : "Uang Fisik Kurang"}
                    </span>
                  </div>
                  <span>
                    {difference === 0
                      ? "Rp 0"
                      : `${difference > 0 ? "+" : ""}${formatRupiah(difference)}`}
                  </span>
                </div>

                {/* Notes Input */}
                <div className="space-y-1 mt-2">
                  <Label htmlFor="closing-notes" className="text-[11px] text-muted-foreground">
                    Catatan Closing (opsional):
                  </Label>
                  <Input
                    id="closing-notes"
                    value={closingNotes}
                    onChange={(e) => setClosingNotes(e.target.value)}
                    placeholder="mis. sisa uang receh 500an, warung ramai lancar"
                    className="text-xs h-9"
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-center space-y-1">
                <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto" />
                <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                  Shift Hari Ini Selesai
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Fisik Kas: {formatRupiah(actualCash)} (
                  {difference === 0
                    ? "PAS"
                    : difference > 0
                      ? `+${formatRupiah(difference)}`
                      : formatRupiah(difference)}
                  )
                </p>
              </div>
            )}

            {/* WhatsApp Target Phone Input Section */}
            {showPhoneInput && (
              <div className="space-y-2 rounded-xl border border-border bg-card p-3">
                <Label className="text-xs font-semibold">Nomor WhatsApp Pemilik / Penerima</Label>
                <div className="flex gap-2">
                  <Input
                    type="tel"
                    placeholder="08xxxxxxxxxx"
                    value={waPhone}
                    onChange={(e) => setWaPhone(e.target.value)}
                    className="text-xs"
                  />
                  <Button size="sm" onClick={handleSendWhatsApp} className="shrink-0 gap-1 text-xs">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Kirim
                  </Button>
                </div>
              </div>
            )}

            {/* Action Buttons: Print, WhatsApp, Close */}
            <div className="space-y-2 pt-1">
              <Button
                variant="outline"
                className="w-full gap-2 text-xs h-10"
                onClick={handlePrintBluetooth}
                disabled={printing}
              >
                {printing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : printerConnected ? (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                {printerConnected ? "Cetak Closing (Bluetooth)" : "Cetak Closing (Hubungkan)"}
              </Button>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="gap-1.5 text-xs h-9"
                  onClick={handleBrowserPrint}
                >
                  <Printer className="h-3.5 w-3.5" />
                  Cetak Layar / PDF
                </Button>
                <Button
                  variant="outline"
                  className="gap-1.5 text-xs h-9 text-emerald-700 dark:text-emerald-400"
                  onClick={() => {
                    if (!waPhone) setShowPhoneInput(true);
                    else handleSendWhatsApp();
                  }}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Kirim WA Rekap
                </Button>
              </div>

              {!isShiftFinished ? (
                <Button
                  className="w-full h-11 text-sm font-bold mt-2"
                  onClick={handleConfirmClose}
                  disabled={closing}
                >
                  {closing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Konfirmasi Tutup Kasir
                </Button>
              ) : (
                <Button
                  className="w-full h-11 text-sm font-bold mt-2"
                  onClick={() => onOpenChange(false)}
                >
                  Selesai
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
