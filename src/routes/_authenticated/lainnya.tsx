import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { clearUserData } from "@/lib/db";
import { clearOutboxQueue, getSyncState, subscribeSync, syncNow } from "@/lib/sync";
import { Button } from "@/components/ui/button";
import {
  Users,
  Settings,
  LogOut,
  RefreshCw,
  Info,
  ChevronRight,
  ShieldCheck,
  Soup,
  Cloud,
  CloudOff,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/lainnya")({
  head: () => ({
    meta: [
      { title: "Lainnya — POS Mie Ayam" },
      {
        name: "description",
        content: "Menu pelanggan, pengaturan toko, sinkronisasi, dan info akun.",
      },
    ],
  }),
  component: LainnyaPage,
});

export function LainnyaPage() {
  const navigate = useNavigate();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [syncState, setSyncState] = useState(getSyncState());
  const [loggingOut, setLoggingOut] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) setUserEmail(user.email);
    });
    return subscribeSync(() => setSyncState(getSyncState()));
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
      toast.success("Berhasil keluar akun");
      navigate({ to: "/auth" });
    } catch {
      toast.error("Gagal keluar akun");
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await syncNow();
      toast.success("Sinkronisasi data selesai");
    } catch {
      toast.error("Sinkronisasi gagal");
    } finally {
      setSyncing(false);
    }
  }

  async function handleClearOutbox() {
    try {
      await clearOutboxQueue();
      toast.success("Antrean data tertunda berhasil dibersihkan");
    } catch {
      toast.error("Gagal membersihkan antrean");
    }
  }

  const menuItems = [
    {
      to: "/pelanggan",
      icon: Users,
      title: "Data Pelanggan",
      description: "Catatan pelanggan, nomor WhatsApp & riwayat pesanan",
      color: "bg-blue-500/10 text-blue-600",
    },
    {
      to: "/pengaturan",
      icon: Settings,
      title: "Pengaturan Toko & Struk",
      description: "Nama warung, alamat, printer Bluetooth & lebar kertas",
      color: "bg-amber-500/10 text-amber-600",
    },
  ];

  return (
    <div className="space-y-4 pb-6">
      <h1 className="text-lg font-bold">Menu Lainnya</h1>

      {/* Main navigation list */}
      <div className="space-y-2">
        {menuItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-accent/40 active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${item.color}`}
              >
                <item.icon className="h-5 w-5" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </Link>
        ))}
      </div>

      {/* Sync Status Card */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {syncState.status === "offline" ? (
                <CloudOff className="h-4 w-4" />
              ) : syncState.status === "syncing" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Cloud className="h-4 w-4" />
              )}
            </div>
            <div>
              <p className="text-xs font-semibold">
                Status Sinkronisasi:{" "}
                <span className="font-normal text-muted-foreground">
                  {syncState.status === "offline"
                    ? "Offline (Tersimpan Lokal)"
                    : syncState.status === "syncing"
                      ? "Sedang Sinkronisasi…"
                      : syncState.pendingCount > 0
                        ? `${syncState.pendingCount} data menunggu upload`
                        : "Data Tersinkronisasi"}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {syncState.pendingCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleClearOutbox}
                className="h-8 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                title="Hapus antrean jika ada data rusak yang menghambat"
              >
                Bersihkan Antrean
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSync}
              disabled={syncing || syncState.status === "offline"}
              className="h-8 gap-1 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              Sinkron
            </Button>
          </div>
        </div>
      </div>

      {/* Account Profile Card */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Soup className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs font-semibold">Akun Kasir</p>
              <p className="text-xs text-muted-foreground">{userEmail || "Kasir Aktif"}</p>
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleLogout}
            disabled={loggingOut}
            className="gap-1.5 text-xs"
          >
            {loggingOut ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="h-3.5 w-3.5" />
            )}
            Keluar
          </Button>
        </div>
      </div>

      {/* App Info Card */}
      <div className="flex items-center gap-2 rounded-xl bg-muted/40 p-3 text-[11px] text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 text-primary" />
        <p>POS Kasir Mie Ayam • Siap offline (PWA) • Cetak Bluetooth &amp; Struk WhatsApp.</p>
      </div>
    </div>
  );
}
