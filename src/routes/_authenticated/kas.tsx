import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { deleteCashFlow, saveCashFlow } from "@/lib/sales";
import { formatRupiah, formatPlain, parseNumberInput, formatTimeId } from "@/lib/format";
import type { CashFlow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

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
  const flows = useLiveQuery(() => db.cash_flows.orderBy("occurred_at").reverse().toArray(), []);
  const transactions = useLiveQuery(
    async () => db.transactions.orderBy("created_at").reverse().limit(500).toArray(),
    [],
  );
  const [dialog, setDialog] = useState<DialogType>(null);
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const todayFlows = (flows ?? []).filter((f) => f.occurred_at.slice(0, 10) === today);
  const todayTx = (transactions ?? []).filter((t) => t.created_at.slice(0, 10) === today);

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
      <h1 className="mb-3 text-lg font-bold">Kas Hari Ini</h1>

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

      <h2 className="mb-2 text-sm font-bold text-muted-foreground">Catatan Hari Ini</h2>
      <div className="space-y-2">
        {todayFlows.map((flow) => (
          <div
            key={flow.id}
            className="flex items-center justify-between rounded-xl border border-border bg-card p-3"
          >
            <div>
              <p className="text-sm font-semibold">{DIALOG_LABEL[flow.type]}</p>
              <p className="text-xs text-muted-foreground">
                {flow.note ?? "—"} · {formatTimeId(flow.occurred_at)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={
                  flow.type === "out"
                    ? "text-sm font-bold text-destructive"
                    : "text-sm font-bold text-emerald-700"
                }
              >
                {flow.type === "out" ? "−" : "+"}
                {formatRupiah(flow.amount)}
              </span>
              <button
                onClick={() => void deleteCashFlow(flow.id)}
                className="text-muted-foreground"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        {!todayFlows.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Belum ada catatan kas hari ini.
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
