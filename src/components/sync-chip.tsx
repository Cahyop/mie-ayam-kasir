import { useEffect, useState } from "react";
import { CloudOff, Cloud, RefreshCw, Loader2 } from "lucide-react";
import { getSyncState, subscribeSync, syncNow } from "@/lib/sync";
import { cn } from "@/lib/utils";

export function SyncChip() {
  const [state, setState] = useState(getSyncState());

  useEffect(() => subscribeSync(() => setState({ ...getSyncState() })), []);

  const label =
    state.status === "offline"
      ? "Offline"
      : state.status === "syncing"
        ? "Sinkron…"
        : state.pendingCount > 0
          ? `${state.pendingCount} menunggu`
          : state.status === "error"
            ? "Gagal sinkron"
            : "Tersinkron";

  return (
    <button
      onClick={() => void syncNow(0)}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        state.status === "offline" || state.status === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : state.pendingCount > 0 || state.status === "syncing"
            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      )}
    >
      {state.status === "offline" ? (
        <CloudOff className="h-3.5 w-3.5" />
      ) : state.status === "syncing" ? (
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
