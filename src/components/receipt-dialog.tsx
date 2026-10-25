import { useEffect, useState } from "react";
import type { ReceiptData } from "@/lib/types";
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
import {
  bluetoothPrintingSupported,
  printViaBluetooth,
  isPrinterConnected,
  subscribePrinterStatus,
} from "@/lib/printer";
import {
  buildReceiptLines,
  buildWaText,
  downloadBlob,
  printBrowserReceipt,
  renderReceiptImage,
  shareReceiptImage,
  waHref,
} from "@/lib/receipt";
import { toast } from "sonner";
import { Printer, Share2, Download, Send, Loader2, FileText } from "lucide-react";

export type ReceiptDialogProps = {
  receipt: ReceiptData | null;
  onClose: () => void;
  paperWidth?: "58" | "80";
};

export function ReceiptDialog({ receipt, onClose, paperWidth = "58" }: ReceiptDialogProps) {
  const [printing, setPrinting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [waPhone, setWaPhone] = useState("");
  const [showPhoneInput, setShowPhoneInput] = useState(false);
  const [printerConnected, setPrinterConnected] = useState(isPrinterConnected());

  useEffect(() => {
    return subscribePrinterStatus((connected) => {
      setPrinterConnected(connected);
    });
  }, []);

  if (!receipt) return null;

  const lines = buildReceiptLines(receipt, paperWidth);

  async function handleBluetoothPrint() {
    if (!receipt) return;
    if (!bluetoothPrintingSupported()) {
      toast.error("Browser ini belum mendukung Web Bluetooth. Coba Cetak Browser.");
      return;
    }
    setPrinting(true);
    try {
      const deviceName = await printViaBluetooth(receipt, paperWidth);
      toast.success(`Berhasil mencetak ke ${deviceName}`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (!errorMsg.toLowerCase().includes("user cancelled")) {
        toast.error(`Gagal mencetak: ${errorMsg}`);
      }
    } finally {
      setPrinting(false);
    }
  }

  function handleBrowserPrint() {
    if (!receipt) return;
    try {
      printBrowserReceipt(receipt, paperWidth);
    } catch {
      toast.error("Gagal membuka jendela cetak.");
    }
  }

  function handleSendWhatsApp(phone?: string) {
    if (!receipt) return;
    const text = buildWaText(receipt);
    const targetPhone = phone || waPhone;
    const url = waHref(text, targetPhone);
    window.open(url, "_blank");
  }

  async function handleShareOrDownloadImage() {
    if (!receipt) return;
    setSharing(true);
    try {
      const blob = await renderReceiptImage(receipt, paperWidth);
      const text = buildWaText(receipt);
      const action = await shareReceiptImage(blob, text, receipt.receiptNo);
      if (action === "shared") {
        toast.success("Struk berhasil dibagikan");
      } else {
        toast.success("Gambar struk diunduh");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes("abort")) {
        toast.error(`Gagal membagikan struk: ${msg}`);
      }
    } finally {
      setSharing(false);
    }
  }

  async function handleDownloadImageOnly() {
    if (!receipt) return;
    try {
      const blob = await renderReceiptImage(receipt, paperWidth);
      downloadBlob(blob, `struk-${receipt.receiptNo}.png`);
      toast.success("Gambar struk diunduh");
    } catch {
      toast.error("Gagal mengunduh gambar struk.");
    }
  }

  return (
    <Dialog open={!!receipt} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto rounded-3xl p-5">
        <DialogHeader>
          <DialogTitle className="text-center text-base font-bold">
            Struk: {receipt.receiptNo}
          </DialogTitle>
        </DialogHeader>

        {/* Thermal receipt paper preview - optimized clarity & size */}
        <div className="my-2 rounded-2xl border border-dashed border-border bg-card p-4 font-mono shadow-sm">
          <div className="space-y-0.5">
            {lines.map((line, idx) => (
              <div
                key={idx}
                className={`whitespace-pre tracking-wide ${
                  line.align === "center" ? "text-center" : "text-left"
                } ${line.bold ? "font-bold text-foreground" : "text-foreground/90"} ${
                  line.large
                    ? "my-1 text-base font-black"
                    : line.doubleHeight
                      ? "my-0.5 text-sm font-black text-primary"
                      : "text-xs"
                } ${line.gapAfter ? "mb-1.5" : ""}`}
              >
                {line.text}
              </div>
            ))}
          </div>
        </div>

        {/* WhatsApp Phone Input Section */}
        {showPhoneInput ? (
          <div className="space-y-2 rounded-xl border border-border bg-card p-3">
            <Label className="text-xs font-semibold">Nomor WhatsApp Pelanggan</Label>
            <div className="flex gap-2">
              <Input
                placeholder="mis. 08123456789"
                value={waPhone}
                onChange={(e) => setWaPhone(e.target.value)}
                className="text-sm"
                autoFocus
              />
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  handleSendWhatsApp(waPhone);
                  setShowPhoneInput(false);
                }}
              >
                <Send className="h-3.5 w-3.5" /> Kirim
              </Button>
            </div>
          </div>
        ) : null}

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button
            variant="default"
            className="w-full gap-2 text-xs"
            onClick={handleBluetoothPrint}
            disabled={printing}
          >
            {printing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : printerConnected ? (
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            ) : (
              <Printer className="h-4 w-4" />
            )}
            {printerConnected ? "Cetak (Terhubung)" : "Cetak Bluetooth"}
          </Button>

          <Button variant="outline" className="w-full gap-2 text-xs" onClick={handleBrowserPrint}>
            <FileText className="h-4 w-4" />
            Cetak Browser
          </Button>

          <Button
            variant="outline"
            className="w-full gap-2 text-xs text-emerald-600 hover:text-emerald-700"
            onClick={() => {
              if (showPhoneInput) {
                handleSendWhatsApp();
              } else {
                setShowPhoneInput(true);
              }
            }}
          >
            <Send className="h-4 w-4" />
            Kirim WhatsApp
          </Button>

          <Button
            variant="outline"
            className="w-full gap-2 text-xs"
            onClick={handleShareOrDownloadImage}
            disabled={sharing}
          >
            {sharing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
            Bagikan Gambar
          </Button>

          <Button
            variant="ghost"
            className="col-span-2 gap-2 text-xs text-muted-foreground"
            onClick={handleDownloadImageOnly}
          >
            <Download className="h-3.5 w-3.5" />
            Unduh Gambar Struk (PNG)
          </Button>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="secondary" className="w-full" onClick={onClose}>
            Selesai / Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
