import { useEffect, useState } from "react";
import { CloudOff, Cloud, RefreshCw, Loader2 } from "lucide-react";
import { getSyncState, subscribeSync, syncNow } from "@/lib/sync";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function SyncChip() {
  const [state, setState] = useState(getSyncState());
  const [manualSyncing, setManualSyncing] = useState(false);

  useEffect(() => subscribeSync(() => setState({ ...getSyncState() })), []);

  async function handleClick() {
    if (manualSyncing || state.status === "syncing") return;

    if (state.status === "offline") {
      toast.error("Perangkat sedang offline (tidak ada koneksi internet)");
      return;
    }

    setManualSyncing(true);
    if (state.pendingCount > 0) {
      toast.info(`Menyinkronkan ${state.pendingCount} data ke cloud...`);
    } else {
      toast.info("Memeriksa pembaruan data...");
    }

    try {
      await syncNow();
      const next = getSyncState();
      if (next.status === "error") {
        toast.error("Gagal sinkron: " + (next.lastError || "Periksa koneksi"));
      } else if (next.pendingCount === 0) {
        toast.success("Semua data berhasil tersinkron ke cloud!");
      } else {
        toast.info(`${next.pendingCount} data dalam antrean.`);
      }
    } catch {
      toast.error("Gagal memproses sinkronisasi");
    } finally {
      setManualSyncing(false);
    }
  }

  const isSyncing = state.status === "syncing" || manualSyncing;

  const label =
    state.status === "offline"
      ? "Offline"
      : isSyncing
        ? "Sinkron…"
        : state.pendingCount > 0
          ? `${state.pendingCount} menunggu`
          : state.status === "error"
            ? "Gagal sinkron"
            : "Tersinkron";

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Klik untuk sinkronisasi data ke cloud"
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:opacity-90 active:scale-95",
        state.status === "offline" || state.status === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : state.pendingCount > 0 || isSyncing
            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      )}
    >
      {state.status === "offline" ? (
        <CloudOff className="h-3.5 w-3.5" />
      ) : isSyncing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : state.status === "error" ? (
        <RefreshCw className="h-3.5 w-3.5" />
      ) : (
        <Cloud className="h-3.5 w-3.5" />
      )}
      {label}
    </button>
  );
}
