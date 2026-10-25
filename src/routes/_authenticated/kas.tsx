import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { deleteCashFlow, saveCashFlow } from "@/lib/sales";
import {
  formatRupiah,
  formatPlain,
  parseNumberInput,
  formatTimeId,
  todayIso,
  toLocalDateIso,
} from "@/lib/format";
import { getActiveShift } from "@/lib/shift";
import { syncNow } from "@/lib/sync";
import { ClosingDialog } from "@/components/closing-dialog";
import type { CashFlow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2, Clock, ChevronDown, ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/kas")({
  head: () => ({
    meta: [
      { title: "Kas — POS Mie Ayam" },
      {
        name: "description",
        content: "Catat modal awal, kas masuk, kas keluar, dan saldo harian.",
      },
    ],
  }),
  component: KasPage,
});

type DialogType = "modal" | "in" | "out" | null;

const DIALOG_LABEL: Record<"modal" | "in" | "out", string> = {
  modal: "Modal Awal",
  in: "Kas Masuk",
  out: "Kas Keluar",
};

function KasPage() {
  const activeShift = useLiveQuery(() => getActiveShift(), []);
  const settings = useLiveQuery(async () => (await db.settings.toArray())[0], []);
  const [closingDialogOpen, setClosingDialogOpen] = useState(false);

  useEffect(() => {
    void syncNow();
  }, []);

  const flows = useLiveQuery(() => db.cash_flows.orderBy("occurred_at").reverse().toArray(), []);
  const transactions = useLiveQuery(
    async () => db.transactions.orderBy("created_at").reverse().limit(500).toArray(),
    [],
  );
  const [dialog, setDialog] = useState<DialogType>(null);
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");

  const today = todayIso();
  const todayFlows = (flows ?? []).filter((f) => toLocalDateIso(f.occurred_at) === today);
  const todayTx = (transactions ?? []).filter((t) => toLocalDateIso(t.created_at) === today);

  const modal = sum(todayFlows, "modal");
  const cashIn = sum(todayFlows, "in");
  const cashOut = sum(todayFlows, "out");
  const cashSales = todayTx
    .filter((t) => t.payment_method === "cash")
    .reduce((s, t) => s + t.total, 0);
  const qrisSales = todayTx
    .filter((t) => t.payment_method === "qris")
    .reduce((s, t) => s + t.total, 0);
  const balance = modal + cashIn + cashSales - cashOut;

  // Kelompokkan catatan kas per hari
  const dayGroups = useMemo(() => {
    if (!flows || flows.length === 0) return [];

    const map = new Map<string, CashFlow[]>();
    for (const flow of flows) {
      const key = toLocalDateIso(flow.occurred_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(flow);
    }

    const groups: {
      dateKey: string;
      dateLabel: string;
      isToday: boolean;
      flows: CashFlow[];
      totalIn: number;
      totalOut: number;
    }[] = [];

    for (const [dateKey, dayFlows] of map.entries()) {
      const isCurrentDay = dateKey === today;
      const d = new Date(dateKey + "T00:00:00");
      const dateLabel = isCurrentDay
        ? `Hari Ini · ${d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}`
        : d.toLocaleDateString("id-ID", {
            weekday: "long",
            day: "numeric",
            month: "short",
            year: "numeric",
          });

      const totalIn = dayFlows
        .filter((f) => f.type === "in" || f.type === "modal")
        .reduce((s, f) => s + f.amount, 0);
      const totalOut = dayFlows.filter((f) => f.type === "out").reduce((s, f) => s + f.amount, 0);

      groups.push({
        dateKey,
        dateLabel,
        isToday: isCurrentDay,
        flows: dayFlows,
        totalIn,
        totalOut,
      });
    }

    groups.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    return groups;
  }, [flows, today]);

  // Hanya hari ini yang langsung expand secara default
  const [expandedDates, setExpandedDates] = useState<Set<string>>(() => new Set([today]));
  const [initializedDates, setInitializedDates] = useState(false);

  useEffect(() => {
    if (dayGroups.length > 0 && !initializedDates) {
      setExpandedDates(new Set([today]));
      setInitializedDates(true);
    }
  }, [dayGroups, initializedDates, today]);

  function handleExpandAll() {
    setExpandedDates(new Set(dayGroups.map((g) => g.dateKey)));
  }

  function handleCollapseAll() {
    setExpandedDates(new Set());
  }

  function toggleDate(dateKey: string) {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      return next;
    });
  }

  async function submit() {
    if (!dialog) return;
    if (amount <= 0) {
      toast.error("Nominal harus lebih dari 0");
      return;
    }
    await saveCashFlow({
      type: dialog,
      amount,
      note: note.trim() || null,
      occurredAt: new Date().toISOString(),
    });
    toast.success(`${DIALOG_LABEL[dialog]} dicatat`);
    setDialog(null);
    setAmount(0);
    setNote("");
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-bold">Kas Hari Ini</h1>
        {activeShift && activeShift.status === "open" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setClosingDialogOpen(true)}
            className="h-8 gap-1.5 text-xs font-semibold text-destructive border-destructive/30 hover:bg-destructive/10"
          >
            <Clock className="h-3.5 w-3.5" />
            Tutup Kasir (Closing)
          </Button>
        )}
      </div>

      {activeShift && activeShift.status === "open" && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-card border border-border p-2.5 text-xs shadow-xs">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span className="font-medium text-muted-foreground">
            Kasir Aktif sejak{" "}
            <strong className="text-foreground">{formatTimeId(activeShift.opened_at)}</strong>{" "}
            (Modal:{" "}
            <strong className="text-foreground">{formatRupiah(activeShift.initial_cash)}</strong>)
          </span>
        </div>
      )}

      <div className="mb-4 rounded-2xl bg-primary p-4 text-primary-foreground">
        <p className="text-xs opacity-80">Saldo kas (tunai)</p>
        <p className="text-2xl font-extrabold">{formatRupiah(balance)}</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <Summary label="Modal awal" value={modal} />
        <Summary label="Kas masuk" value={cashIn} />
        <Summary label="Kas keluar" value={-cashOut} />
        <Summary label="Jual tunai" value={cashSales} />
        <Summary label="Jual QRIS" value={qrisSales} className="col-span-2" />
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <Button variant="secondary" size="sm" onClick={() => setDialog("modal")}>
          Modal Awal
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setDialog("in")}>
          Kas Masuk
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setDialog("out")}>
          Kas Keluar
        </Button>
      </div>

      {/* Riwayat Catatan Kas Dikelompokkan per Hari */}
      <div className="mb-2.5 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-foreground">Riwayat Catatan Kas</h2>
          <p className="text-[11px] text-muted-foreground">
            Dikelompokkan per hari (hari ini terbuka otomatis).
          </p>
        </div>
        {dayGroups.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExpandAll}
              className="h-7 text-xs px-2 gap-1 font-medium"
            >
              <ChevronsUpDown className="h-3.5 w-3.5" />
              Expand Semua
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCollapseAll}
              className="h-7 text-xs px-2 gap-1 font-medium"
            >
              <ChevronsDownUp className="h-3.5 w-3.5" />
              Collapse Semua
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        {dayGroups.map((group) => {
          const isExpanded = expandedDates.has(group.dateKey);

          return (
            <div
              key={group.dateKey}
              className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs transition-all"
            >
              {/* Group Header Button */}
              <button
                type="button"
                onClick={() => toggleDate(group.dateKey)}
                className="w-full flex items-center justify-between p-3.5 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-foreground">{group.dateLabel}</span>
                    {group.isToday && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 h-4 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-bold"
                      >
                        Hari Ini
                      </Badge>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      ({group.flows.length} catatan)
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                    <span>
                      Masuk:{" "}
                      <strong className="text-emerald-700 dark:text-emerald-400">
                        +{formatRupiah(group.totalIn)}
                      </strong>
                    </span>
                    <span>
                      Keluar:{" "}
                      <strong className="text-destructive">−{formatRupiah(group.totalOut)}</strong>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-muted-foreground shrink-0 ml-2">
                  <span className="text-xs font-semibold">{isExpanded ? "Tutup" : "Buka"}</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      isExpanded && "rotate-180",
                    )}
                  />
                </div>
              </button>

              {/* Collapsible Content */}
              {isExpanded && (
                <div className="p-3 divide-y divide-border border-t border-border space-y-2">
                  {group.flows.map((flow) => (
                    <div
                      key={flow.id}
                      className="flex items-center justify-between pt-2 first:pt-0"
                    >
                      <div>
                        <p className="text-xs font-bold text-foreground">
                          {DIALOG_LABEL[flow.type]}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {flow.note ?? "—"} · {formatTimeId(flow.occurred_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            flow.type === "out"
                              ? "text-xs font-bold text-destructive"
                              : "text-xs font-bold text-emerald-700 dark:text-emerald-400"
                          }
                        >
                          {flow.type === "out" ? "−" : "+"}
                          {formatRupiah(flow.amount)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void deleteCashFlow(flow.id)}
                          className="text-muted-foreground hover:text-destructive p-1 rounded-md transition-colors"
                          title="Hapus catatan kas"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {dayGroups.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Belum ada catatan kas yang tersimpan.
          </p>
        )}
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{dialog ? DIALOG_LABEL[dialog] : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nominal (Rp)</Label>
              <Input
                inputMode="numeric"
                autoFocus
                value={amount ? formatPlain(amount) : ""}
                onChange={(e) => setAmount(parseNumberInput(e.target.value))}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Keterangan</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={dialog === "out" ? "mis. beli kerupuk" : "mis. uang kembalian"}
              />
            </div>
            <Button onClick={submit} className="w-full">
              Simpan
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Shift Closing Dialog */}
      <ClosingDialog
        open={closingDialogOpen}
        onOpenChange={setClosingDialogOpen}
        shift={activeShift ?? null}
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

function sum(flows: CashFlow[], type: CashFlow["type"]) {
  return flows.filter((f) => f.type === type).reduce((s, f) => s + f.amount, 0);
}

function Summary({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-card p-3 ${className ?? ""}`}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-base font-bold ${value < 0 ? "text-destructive" : ""}`}>
        {formatRupiah(value)}
      </p>
    </div>
  );
}
