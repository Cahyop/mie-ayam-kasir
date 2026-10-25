import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { enqueueUpsert, getUserId, syncNow } from "@/lib/sync";
import {
  bluetoothPrintingSupported,
  connectPrinter,
  disconnectPrinter,
  getSavedPrinterName,
  isPrinterConnected,
  isKeepConnectedEnabled,
  setKeepConnectedEnabled,
  subscribePrinterStatus,
  printViaBluetooth,
} from "@/lib/printer";
import type { Settings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Store,
  Printer,
  RefreshCw,
  Database,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pengaturan")({
  head: () => ({
    meta: [
      { title: "Pengaturan — POS Mie Ayam" },
      {
        name: "description",
        content: "Konfigurasi toko, struk, printer Bluetooth, dan sinkronisasi.",
      },
    ],
  }),
  component: PengaturanPage,
});

export function PengaturanPage() {
  const userId = getUserId();
  const settings = useLiveQuery(async () => (await db.settings.toArray())[0], []);

  // Form states
  const [storeName, setStoreName] = useState("Mie Ayam");
  const [storeAddress, setStoreAddress] = useState("");
  const [storePhone, setStorePhone] = useState("");
  const [receiptFooter, setReceiptFooter] = useState("Terima kasih atas kunjungan Anda!");
  const [paperWidth, setPaperWidth] = useState<"58" | "80">("58");

  // Printer states
  const [printerName, setPrinterName] = useState<string | null>(getSavedPrinterName());
  const [printerConnected, setPrinterConnected] = useState(isPrinterConnected());
  const [keepConnected, setKeepConnected] = useState(isKeepConnectedEnabled());
  const [connectingPrinter, setConnectingPrinter] = useState(false);
  const [testPrinting, setTestPrinting] = useState(false);

  // Sync states
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Statistics
  const productCount = useLiveQuery(() => db.products.count(), []);
  const txCount = useLiveQuery(() => db.transactions.count(), []);
  const customerCount = useLiveQuery(() => db.customers.count(), []);
  const outboxCount = useLiveQuery(() => db.outbox.count(), []);

  useEffect(() => {
    if (settings) {
      setStoreName(settings.store_name ?? "Mie Ayam");
      setStoreAddress(settings.store_address ?? "");
      setStorePhone(settings.store_phone ?? "");
      setReceiptFooter(settings.receipt_footer ?? "Terima kasih atas kunjungan Anda!");
      setPaperWidth(settings.paper_width ?? "58");
    }
  }, [settings]);

  useEffect(() => {
    return subscribePrinterStatus((connected, name) => {
      setPrinterConnected(connected);
      if (name) setPrinterName(name);
    });
  }, []);

  async function handleSaveSettings(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!storeName.trim()) {
      toast.error("Nama toko wajib diisi");
      return;
    }
    const uid = userId || settings?.user_id || "anonymous";
    setSaving(true);
    try {
      const row: Settings = {
        user_id: uid,
        store_name: storeName.trim(),
        store_address: storeAddress.trim() || null,
        store_phone: storePhone.trim() || null,
        receipt_footer: receiptFooter.trim(),
        paper_width: paperWidth,
        updated_at: new Date().toISOString(),
      };
      await db.settings.put(row);
      await enqueueUpsert("settings", row);
      toast.success("Pengaturan berhasil disimpan");
    } catch {
      toast.error("Gagal menyimpan pengaturan");
    } finally {
      setSaving(false);
    }
  }

  async function handleConnectBluetooth() {
    if (!bluetoothPrintingSupported()) {
      toast.error("Perangkat atau browser ini tidak mendukung Web Bluetooth API.");
      return;
    }
    setConnectingPrinter(true);
    try {
      const conn = await connectPrinter(true);
      setPrinterName(conn.deviceName);
      setPrinterConnected(true);
      toast.success(`Terhubung ke printer ${conn.deviceName}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes("user cancelled")) {
        toast.error(`Gagal menghubungkan printer: ${msg}`);
      }
    } finally {
      setConnectingPrinter(false);
    }
  }

  function handleToggleKeepConnected(val: boolean) {
    setKeepConnected(val);
    setKeepConnectedEnabled(val);
    toast.success(
      val
        ? "Mode Konek Terus diaktifkan (siap cetak instan)"
        : "Mode Konek Terus dinonaktifkan (koneksi ditutup setelah cetak)",
    );
  }

  async function handleTestPrint() {
    setTestPrinting(true);
    try {
      await printViaBluetooth(
        {
          receiptNo: "TEST-PRINT",
          createdAt: new Date().toISOString(),
          storeName: storeName || "Mie Ayam",
          storeAddress: storeAddress || null,
          storePhone: storePhone || null,
          footer: "Tes Cetak Bluetooth Berhasil!",
          items: [{ name: "Mie Ayam (Tes Cetak)", qty: 1, price: 15000, total: 15000 }],
          subtotal: 15000,
          discount: 0,
          total: 15000,
          paymentMethod: "cash",
          paidAmount: 15000,
          changeAmount: 0,
          customerName: "Tes Printer",
        },
        paperWidth,
      );
      toast.success("Tes cetak berhasil!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Gagal tes cetak: ${msg}`);
    } finally {
      setTestPrinting(false);
    }
  }

  async function handleManualSync() {
    setSyncing(true);
    try {
      await syncNow();
      toast.success("Sinkronisasi selesai");
    } catch {
      toast.error("Sinkronisasi gagal, periksa koneksi internet");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-5 pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Pengaturan</h1>
        <Button size="sm" onClick={() => handleSaveSettings()} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-4 w-4" />
          )}
          Simpan
        </Button>
      </div>

      {/* Profil Toko */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-sm font-semibold">
          <Store className="h-4 w-4 text-primary" />
          <span>Profil Toko &amp; Struk</span>
        </div>
        <form onSubmit={handleSaveSettings} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nama Toko / Warung *</Label>
            <Input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="mis. Mie Ayam Bangka Mantap"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Alamat Toko</Label>
            <Input
              value={storeAddress}
              onChange={(e) => setStoreAddress(e.target.value)}
              placeholder="mis. Jl. Ahmad Yani No. 12, Jakarta"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">No. Telepon / WhatsApp Toko</Label>
            <Input
              value={storePhone}
              onChange={(e) => setStorePhone(e.target.value)}
              placeholder="mis. 0812-3456-7890"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Pesan Footer Struk</Label>
            <Textarea
              rows={2}
              value={receiptFooter}
              onChange={(e) => setReceiptFooter(e.target.value)}
              placeholder="mis. Terima kasih atas kunjungan Anda!"
            />
          </div>
          <div className="space-y-2 pt-1">
            <Label className="text-xs">Lebar Kertas Struk</Label>
            <RadioGroup
              value={paperWidth}
              onValueChange={(v) => setPaperWidth(v as "58" | "80")}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="58" id="pw-58" />
                <Label htmlFor="pw-58" className="text-xs font-normal">
                  58 mm (Standar POS Portabel)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="80" id="pw-80" />
                <Label htmlFor="pw-80" className="text-xs font-normal">
                  80 mm (Printer Besar)
                </Label>
              </div>
            </RadioGroup>
          </div>
        </form>
      </section>

      {/* Printer Bluetooth Settings */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2 text-sm font-semibold">
          <div className="flex items-center gap-2">
            <Printer className="h-4 w-4 text-primary" />
            <span>Printer Thermal Bluetooth</span>
          </div>
          {bluetoothPrintingSupported() ? (
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> Web Bluetooth Aktif
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
              <AlertCircle className="h-3 w-3" /> Tanpa Web Bluetooth
            </span>
          )}
        </div>

        <div className="space-y-3">
          {/* Status Bar */}
          <div className="flex items-center justify-between rounded-xl bg-muted/50 p-3">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    printerConnected
                      ? "bg-emerald-500 animate-pulse"
                      : printerName
                        ? "bg-amber-400"
                        : "bg-muted-foreground/40"
                  }`}
                />
                <p className="text-xs font-bold">
                  {printerConnected
                    ? `Terhubung: ${printerName || "Printer Bluetooth"}`
                    : printerName
                      ? `Tersimpan (Belum Konek): ${printerName}`
                      : "Belum Ada Printer Terhubung"}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {printerConnected
                  ? "Koneksi aktif dan siap mencetak struk instan"
                  : "Tekan Hubungkan untuk menyambungkan"}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant={printerConnected ? "outline" : "default"}
                onClick={handleConnectBluetooth}
                disabled={connectingPrinter}
                className="gap-1.5 text-xs"
              >
                {connectingPrinter ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Printer className="h-3.5 w-3.5" />
                )}
                {printerConnected ? "Ganti" : "Hubungkan"}
              </Button>
              {printerConnected && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    disconnectPrinter();
                    toast.info("Printer diputuskan");
                  }}
                  className="text-xs text-destructive hover:text-destructive"
                >
                  Putuskan
                </Button>
              )}
            </div>
          </div>

          {/* Setting: Jaga Printer Tetap Terhubung (Konek Terus) */}
          <div className="flex items-center justify-between rounded-xl border border-border p-3">
            <div className="space-y-0.5 pr-2">
              <Label htmlFor="keep-connected" className="text-xs font-semibold cursor-pointer">
                Jaga printer tetap terhubung (Konek Terus)
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Koneksi Bluetooth tidak akan diputus setelah cetak, sehingga cetak struk berikutnya
                langsung keluar instan tanpa pop-up pairing.
              </p>
            </div>
            <Switch
              id="keep-connected"
              checked={keepConnected}
              onCheckedChange={handleToggleKeepConnected}
            />
          </div>

          {/* Test Print Button */}
          {printerConnected && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestPrint}
              disabled={testPrinting}
              className="w-full gap-2 text-xs"
            >
              {testPrinting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              )}
              Tes Cetak Struk Singkat
            </Button>
          )}

          {/* Panduan Singkat */}
          <div className="rounded-xl bg-amber-500/10 p-2.5 text-[11px] text-amber-800 dark:text-amber-300">
            <p className="font-semibold mb-0.5">💡 Tips koneksi Bluetooth:</p>
            <p>
              Pastikan Bluetooth HP/laptop menyala dan printer thermal dalam posisi ON. Jika
              menggunakan Google Chrome di HP Android, izinkan akses "Perangkat di sekitar".
            </p>
          </div>
        </div>
      </section>

      {/* Sinkronisasi & Data Lokal */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2 text-sm font-semibold">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <span>Data &amp; Sinkronisasi</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleManualSync}
            disabled={syncing}
            className="h-7 gap-1 px-2 text-xs"
          >
            <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
            Sinkron Sekarang
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-border p-2.5">
            <span className="text-muted-foreground">Menu Produk</span>
            <p className="mt-0.5 text-sm font-bold">{productCount ?? 0} item</p>
          </div>
          <div className="rounded-xl border border-border p-2.5">
            <span className="text-muted-foreground">Transaksi</span>
            <p className="mt-0.5 text-sm font-bold">{txCount ?? 0} nota</p>
          </div>
          <div className="rounded-xl border border-border p-2.5">
            <span className="text-muted-foreground">Pelanggan</span>
            <p className="mt-0.5 text-sm font-bold">{customerCount ?? 0} orang</p>
          </div>
          <div className="rounded-xl border border-border p-2.5">
            <span className="text-muted-foreground">Antrean Sinkron (Outbox)</span>
            <p className="mt-0.5 text-sm font-bold">{outboxCount ?? 0} data</p>
          </div>
        </div>
      </section>
    </div>
  );
}
