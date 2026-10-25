import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, resetTransactionData } from "@/lib/db";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Store,
  Printer,
  RefreshCw,
  Database,
  Save,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Trash2,
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

  // Sync & Reset states
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

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
      toast.error("Gagal melakukan sinkronisasi");
    } finally {
      setSyncing(false);
    }
  }

  async function handleResetTransactions() {
    setResetting(true);
    try {
      await resetTransactionData();
      toast.success("Semua data transaksi dan kas berhasil direset bersih!");
    } catch {
      toast.error("Gagal mereset data transaksi");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="text-lg font-bold">Pengaturan</h1>
        <p className="text-xs text-muted-foreground">
          Kelola profil warung, format struk, printer Bluetooth, dan sinkronisasi data.
        </p>
      </div>

      {/* Profil Toko & Struk */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-sm font-semibold">
          <Store className="h-4 w-4 text-primary" />
          <span>Profil Toko &amp; Struk</span>
        </div>

        <form onSubmit={handleSaveSettings} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="store-name" className="text-xs font-semibold">
              Nama Toko / Warung *
            </Label>
            <Input
              id="store-name"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="mis. Mie Ayam Berkah"
              className="text-xs"
              required
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="store-address" className="text-xs font-semibold">
              Alamat Toko
            </Label>
            <Input
              id="store-address"
              value={storeAddress}
              onChange={(e) => setStoreAddress(e.target.value)}
              placeholder="mis. Jl. Merdeka No. 10, Jakarta"
              className="text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="store-phone" className="text-xs font-semibold">
              Nomor WhatsApp / Telepon
            </Label>
            <Input
              id="store-phone"
              value={storePhone}
              onChange={(e) => setStorePhone(e.target.value)}
              placeholder="mis. 08123456789"
              className="text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="receipt-footer" className="text-xs font-semibold">
              Pesan Footer Struk
            </Label>
            <Textarea
              id="receipt-footer"
              value={receiptFooter}
              onChange={(e) => setReceiptFooter(e.target.value)}
              rows={2}
              placeholder="mis. Terima kasih atas kunjungan Anda!"
              className="text-xs resize-none"
            />
          </div>

          <div className="space-y-2 pt-1">
            <Label className="text-xs font-semibold">Lebar Kertas Struk</Label>
            <RadioGroup
              value={paperWidth}
              onValueChange={(val: "58" | "80") => setPaperWidth(val)}
              className="grid grid-cols-2 gap-3"
            >
              <label
                htmlFor="paper-58"
                className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 text-xs transition-colors ${
                  paperWidth === "58"
                    ? "border-primary bg-primary/5 font-semibold text-primary"
                    : "border-border text-foreground hover:bg-muted/50"
                }`}
              >
                <div>
                  <p className="font-bold">58 mm (Mini)</p>
                  <p className="text-[11px] text-muted-foreground">
                    Printer Bluetooth portable kasir
                  </p>
                </div>
                <RadioGroupItem value="58" id="paper-58" />
              </label>

              <label
                htmlFor="paper-80"
                className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 text-xs transition-colors ${
                  paperWidth === "80"
                    ? "border-primary bg-primary/5 font-semibold text-primary"
                    : "border-border text-foreground hover:bg-muted/50"
                }`}
              >
                <div>
                  <p className="font-bold">80 mm (Standar)</p>
                  <p className="text-[11px] text-muted-foreground">Printer kasir desktop meja</p>
                </div>
                <RadioGroupItem value="80" id="paper-80" />
              </label>
            </RadioGroup>
          </div>

          <Button type="submit" disabled={saving} className="w-full gap-2 text-xs">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Simpan Pengaturan
          </Button>
        </form>
      </section>

      {/* Printer Bluetooth Thermal */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2 text-sm font-semibold">
          <div className="flex items-center gap-2">
            <Printer className="h-4 w-4 text-primary" />
            <span>Printer Thermal</span>
          </div>
          {bluetoothPrintingSupported() ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> Bluetooth Didukung
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-amber-600">
              <AlertCircle className="h-3 w-3" /> Gunakan Chrome Android/PC
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

        {/* Zona Reset Data Transaksi Uji Coba */}
        <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-destructive flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Reset Transaksi Uji Coba
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Hapus semua riwayat transaksi, catatan kas, dan sesi kasir selama uji coba. Menu
                produk dan data pelanggan Anda akan tetap tersimpan aman.
              </p>
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resetting || ((txCount ?? 0) === 0 && (outboxCount ?? 0) === 0)}
                  className="h-8 shrink-0 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Reset
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-sm rounded-2xl p-5">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-base font-bold text-destructive">
                    Reset Data Transaksi Uji Coba?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-xs text-muted-foreground">
                    Semua riwayat penjualan, nota, catatan kas, dan status kasir hari ini akan
                    dihapus permanen. Menu mie ayam, harga produk, dan pengaturan toko Anda akan
                    tetap utuh.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2 pt-2">
                  <AlertDialogCancel className="text-xs">Batal</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleResetTransactions}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs"
                  >
                    Ya, Reset Sekarang
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </section>
    </div>
  );
}
