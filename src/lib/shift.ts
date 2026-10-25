import { db, getMeta, setMeta } from "./db";
import { formatPlain, formatRupiah, isToday, toLocalDateIso, todayIso, uid } from "./format";
import { receiptCols } from "./receipt";
import { saveCashFlow } from "./sales";
import { getUserId } from "./sync";
import type { ReceiptLine, RegisterShift, ShiftSummary } from "./types";

export const ACTIVE_SHIFT_KEY = "active_shift";
export const SHIFT_HISTORY_KEY = "shift_history";
export const POS_ACTIVE_SHIFT_KEY = "pos_active_shift";
export const POS_SHIFT_HISTORY_KEY = "pos_shift_history";

async function getShiftHistoryRaw(): Promise<RegisterShift[]> {
  try {
    let history = (await getMeta<RegisterShift[]>(SHIFT_HISTORY_KEY)) || [];
    if (history.length === 0 && typeof window !== "undefined" && window.localStorage) {
      const raw = localStorage.getItem(POS_SHIFT_HISTORY_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as RegisterShift[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            history = parsed;
          }
        } catch {
          // ignore
        }
      }
    }
    return history;
  } catch {
    return [];
  }
}

/**
 * Auto-recovery shift jika kasir sudah aktif hari ini:
 * 1. Dari db.cash_flows (modal pembukaan hari ini yang belum ditutup)
 * 2. Dari db.transactions (jika hari ini sudah ada transaksi penjualan!)
 */
async function tryRecoverShift(): Promise<RegisterShift | null> {
  try {
    const today = todayIso();
    const history = await getShiftHistoryRaw();

    // 1. Coba recover dari modal di cash_flows
    const flows = await db.cash_flows.toArray();
    const modalFlows = flows
      .filter((f) => {
        if (f.type !== "modal" || !f.occurred_at) return false;
        const diffHours = (Date.now() - new Date(f.occurred_at).getTime()) / (1000 * 60 * 60);
        return isToday(f.occurred_at) || (diffHours >= 0 && diffHours < 24);
      })
      .sort((a, b) => (b.occurred_at > a.occurred_at ? 1 : -1));

    if (modalFlows.length > 0) {
      const latestModal = modalFlows[0];
      const modalClosed = history.some((s) => {
        if (s.status !== "closed") return false;
        if (s.opened_at === latestModal.occurred_at) return true;
        if (s.closed_at && s.closed_at >= latestModal.occurred_at) return true;
        return false;
      });

      if (!modalClosed) {
        const userId = latestModal.user_id || getUserId() || "anonymous";
        return {
          id: `shift-modal-${latestModal.id}`,
          user_id: userId,
          date: toLocalDateIso(latestModal.occurred_at),
          status: "open",
          opened_at: latestModal.occurred_at,
          closed_at: null,
          initial_cash: Math.max(0, latestModal.amount || 0),
          notes: latestModal.note ? latestModal.note.replace(/^Modal Kasir:\s*/, "") : null,
        };
      }
    }

    // 2. Jika modal flow tidak ada/belum tercatat, TETAPI sudah ada transaksi penjualan hari ini!
    const txs = await db.transactions.toArray();
    const todayTxs = txs
      .filter((t) => t.created_at && isToday(t.created_at))
      .sort((a, b) => (a.created_at > b.created_at ? 1 : -1)); // earliest first

    if (todayTxs.length > 0) {
      const latestTx = todayTxs[todayTxs.length - 1]; // latest transaction
      const earliestTx = todayTxs[0]; // first transaction of the day

      // Cek apakah transaksi hari ini sudah pernah ditutup dalam shift history
      const txsClosed = history.some((s) => {
        if (s.status !== "closed") return false;
        if (s.closed_at && s.closed_at >= latestTx.created_at) return true;
        return false;
      });

      if (!txsClosed) {
        // Ada transaksi hari ini yang belum ditutup -> SHIFT AKTIF!
        const userId = latestTx.user_id || getUserId() || "anonymous";
        return {
          id: `shift-tx-${today}`,
          user_id: userId,
          date: today,
          status: "open",
          opened_at: earliestTx.created_at,
          closed_at: null,
          initial_cash: 0,
          notes: "Dipulihkan otomatis dari transaksi hari ini",
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function getActiveShift(): Promise<RegisterShift | null> {
  try {
    let shift = await getMeta<RegisterShift>(ACTIVE_SHIFT_KEY);

    // 1. Fallback dari backup localStorage jika meta IndexedDB hilang
    if (!shift || shift.status !== "open") {
      if (typeof window !== "undefined" && window.localStorage) {
        const raw = localStorage.getItem(POS_ACTIVE_SHIFT_KEY);
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as RegisterShift;
            if (parsed && parsed.status === "open") {
              shift = parsed;
            }
          } catch {
            // ignore
          }
        }
      }
    }

    // 2. Auto-recover dari buku kas atau transaksi hari ini
    if (!shift || shift.status !== "open") {
      const recovered = await tryRecoverShift();
      if (recovered) {
        shift = recovered;
      }
    }

    if (shift && shift.status === "open") {
      // Simpan ke localStorage dan db.meta di background (setTimeout)
      // JANGAN await setMeta di sini secara sinkron agar tidak memicu infinite re-query di useLiveQuery
      if (typeof window !== "undefined") {
        const activeShiftToPersist = shift;
        setTimeout(async () => {
          try {
            localStorage.setItem(POS_ACTIVE_SHIFT_KEY, JSON.stringify(activeShiftToPersist));
            const existing = await getMeta<RegisterShift>(ACTIVE_SHIFT_KEY);
            if (
              !existing ||
              existing.id !== activeShiftToPersist.id ||
              existing.status !== activeShiftToPersist.status
            ) {
              await setMeta(ACTIVE_SHIFT_KEY, activeShiftToPersist);
            }
          } catch {
            // ignore
          }
        }, 0);
      }
      return shift;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getShiftHistory(): Promise<RegisterShift[]> {
  try {
    let history = (await getMeta<RegisterShift[]>(SHIFT_HISTORY_KEY)) || [];
    if (history.length === 0 && typeof window !== "undefined" && window.localStorage) {
      const raw = localStorage.getItem(POS_SHIFT_HISTORY_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as RegisterShift[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            history = parsed;
            await setMeta(SHIFT_HISTORY_KEY, history);
          }
        } catch {
          // ignore
        }
      }
    }
    const active = await getActiveShift();
    if (active) {
      return [active, ...history.filter((s) => s.id !== active.id)];
    }
    return history;
  } catch {
    return [];
  }
}

export async function openShift(initialCash: number, notes?: string): Promise<RegisterShift> {
  const userId = getUserId() || "anonymous";
  const now = new Date().toISOString();
  const date = todayIso();

  const shift: RegisterShift = {
    id: uid(),
    user_id: userId,
    date,
    status: "open",
    opened_at: now,
    closed_at: null,
    initial_cash: Math.max(0, initialCash),
    notes: notes || null,
  };

  await setMeta(ACTIVE_SHIFT_KEY, shift);
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(POS_ACTIVE_SHIFT_KEY, JSON.stringify(shift));
    } catch {
      // ignore
    }
  }

  // Catat modal awal otomatis ke buku kas agar tersinkronisasi
  try {
    await saveCashFlow({
      type: "modal",
      amount: Math.max(0, initialCash),
      note: notes ? `Modal Kasir: ${notes}` : "Modal Awal Buka Kasir",
      occurredAt: now,
    });
  } catch {
    // ignore
  }

  return shift;
}

export async function calculateShiftSummary(
  shift: RegisterShift,
  actualCash = 0,
  closedAt?: string,
): Promise<ShiftSummary> {
  const end = closedAt || new Date().toISOString();

  const [txs, flows] = await Promise.all([db.transactions.toArray(), db.cash_flows.toArray()]);

  // Transaksi dalam shift ini: cocokkan shift_id jika ada, atau rentang waktu
  const shiftTxs = txs.filter((t) => {
    if (t.shift_id) return t.shift_id === shift.id;
    if (!t.created_at) return false;
    return t.created_at >= shift.opened_at && t.created_at <= end;
  });

  const shiftFlows = flows.filter((f) => {
    if (!f.occurred_at) return false;
    return f.occurred_at >= shift.opened_at && f.occurred_at <= end;
  });

  const cashTxs = shiftTxs.filter((t) => t.payment_method === "cash");
  const qrisTxs = shiftTxs.filter((t) => t.payment_method === "qris");

  const cashSales = cashTxs.reduce((sum, t) => sum + t.total, 0);
  const qrisSales = qrisTxs.reduce((sum, t) => sum + t.total, 0);
  const totalSales = cashSales + qrisSales;

  // Kas masuk dan kas keluar selain modal awal pembukaan
  const cashIn = shiftFlows.filter((f) => f.type === "in").reduce((sum, f) => sum + f.amount, 0);

  const cashOut = shiftFlows.filter((f) => f.type === "out").reduce((sum, f) => sum + f.amount, 0);

  const expectedCash = shift.initial_cash + cashSales + cashIn - cashOut;
  const difference = actualCash - expectedCash;

  return {
    shiftId: shift.id,
    openedAt: shift.opened_at,
    closedAt: end,
    initialCash: shift.initial_cash,
    cashSales,
    cashTxCount: cashTxs.length,
    qrisSales,
    qrisTxCount: qrisTxs.length,
    totalSales,
    totalTxCount: shiftTxs.length,
    cashIn,
    cashOut,
    expectedCash,
    actualCash,
    difference,
    notes: shift.notes,
  };
}

export async function closeShift(
  shift: RegisterShift,
  actualCash: number,
  closingNotes?: string,
): Promise<ShiftSummary> {
  const closedAt = new Date().toISOString();
  const summary = await calculateShiftSummary(shift, actualCash, closedAt);

  const updatedShift: RegisterShift = {
    ...shift,
    status: "closed",
    closed_at: closedAt,
    actual_cash: actualCash,
    expected_cash: summary.expectedCash,
    difference: summary.difference,
    notes: closingNotes ? `${shift.notes ? shift.notes + " | " : ""}${closingNotes}` : shift.notes,
  };

  // Simpan ke riwayat shift di meta & localStorage
  try {
    const history = (await getMeta<RegisterShift[]>(SHIFT_HISTORY_KEY)) || [];
    const filtered = history.filter((s) => s.id !== updatedShift.id);
    filtered.unshift(updatedShift);
    const sliced = filtered.slice(0, 100);
    await setMeta(SHIFT_HISTORY_KEY, sliced);
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        localStorage.setItem(POS_SHIFT_HISTORY_KEY, JSON.stringify(sliced));
        localStorage.removeItem(POS_ACTIVE_SHIFT_KEY);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  // Set active shift ke null / reset
  await setMeta(ACTIVE_SHIFT_KEY, null);
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.removeItem(POS_ACTIVE_SHIFT_KEY);
    } catch {
      // ignore
    }
  }

  return summary;
}

function twoCol(left: string, right: string, cols: number): string {
  const l =
    left.length > cols - right.length - 1 ? left.slice(0, cols - right.length - 2) + "…" : left;
  const spaces = Math.max(1, cols - l.length - right.length);
  return l + " ".repeat(spaces) + right;
}

function rule(cols: number): string {
  return "-".repeat(cols);
}

export function buildShiftReceiptLines(
  summary: ShiftSummary,
  storeName: string,
  paperWidth: "58" | "80",
): ReceiptLine[] {
  const cols = receiptCols(paperWidth);
  const lines: ReceiptLine[] = [];
  const push = (line: ReceiptLine) => lines.push(line);

  push({ text: storeName || "KASIR MIE AYAM", align: "center", bold: true, large: true });
  push({ text: "LAPORAN CLOSING KASIR", align: "center", bold: true });

  const dOpen = new Date(summary.openedAt);
  const dClose = new Date(summary.closedAt);
  const dateStr = dClose.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timeOpen = dOpen.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const timeClose = dClose.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  push({ text: twoCol(dateStr, `${timeOpen} - ${timeClose}`, cols) });
  push({ text: rule(cols) });

  push({ text: twoCol("Modal Awal", formatPlain(summary.initialCash), cols) });
  push({
    text: twoCol(`Jual Tunai (${summary.cashTxCount})`, formatPlain(summary.cashSales), cols),
  });
  push({
    text: twoCol(`Jual QRIS (${summary.qrisTxCount})`, formatPlain(summary.qrisSales), cols),
  });

  push({ text: rule(cols) });
  push({
    text: twoCol(`TOTAL OMSET (${summary.totalTxCount})`, formatPlain(summary.totalSales), cols),
    bold: true,
  });

  if (summary.cashIn > 0) {
    push({ text: twoCol("Kas Masuk Lain", `+${formatPlain(summary.cashIn)}`, cols) });
  }
  if (summary.cashOut > 0) {
    push({ text: twoCol("Kas Keluar", `-${formatPlain(summary.cashOut)}`, cols) });
  }

  push({ text: rule(cols) });
  push({
    text: twoCol("Uang Laci (Sistem)", formatPlain(summary.expectedCash), cols),
    bold: true,
  });
  push({
    text: twoCol("Uang Fisik Dihitung", formatPlain(summary.actualCash), cols),
    bold: true,
  });

  const diffLabel =
    summary.difference === 0
      ? "PAS (Rp 0)"
      : summary.difference > 0
        ? `LEBIH (+${formatPlain(summary.difference)})`
        : `KURANG (${formatPlain(summary.difference)})`;

  push({
    text: twoCol("SELISIH KAS", diffLabel, cols),
    bold: true,
    doubleHeight: true,
  });

  push({ text: rule(cols) });
  if (summary.notes) {
    push({ text: `Catatan: ${summary.notes}` });
    push({ text: rule(cols) });
  }

  push({ text: "Laporan otomatis tersimpan", align: "center" });

  return lines;
}

export function buildShiftWaText(summary: ShiftSummary, storeName: string): string {
  const dOpen = new Date(summary.openedAt);
  const dClose = new Date(summary.closedAt);
  const dateStr = dClose.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeOpen = dOpen.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const timeClose = dClose.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  const diffLabel =
    summary.difference === 0
      ? "PAS (Rp 0)"
      : summary.difference > 0
        ? `LEBIH (+${formatRupiah(summary.difference)})`
        : `KURANG (${formatRupiah(summary.difference)})`;

  const out: string[] = [];
  out.push(`📊 *LAPORAN CLOSING KASIR*`);
  out.push(`*${storeName || "Mie Ayam"}*`);
  out.push(`📅 ${dateStr}`);
  out.push(`⏰ Operasional: ${timeOpen} – ${timeClose}`);
  out.push(`────────────────`);
  out.push(`💵 *Modal Awal:* ${formatRupiah(summary.initialCash)}`);
  out.push(`💰 *Jual Tunai:* ${formatRupiah(summary.cashSales)} (${summary.cashTxCount} nota)`);
  out.push(`📱 *Jual QRIS:* ${formatRupiah(summary.qrisSales)} (${summary.qrisTxCount} nota)`);
  out.push(`⭐ *Total Omset:* ${formatRupiah(summary.totalSales)} (${summary.totalTxCount} nota)`);
  out.push(`────────────────`);
  if (summary.cashIn > 0) {
    out.push(`📥 Kas Masuk: +${formatRupiah(summary.cashIn)}`);
  }
  if (summary.cashOut > 0) {
    out.push(`🔻 Kas Keluar: -${formatRupiah(summary.cashOut)}`);
  }
  out.push(`🗄️ *Uang Kas di Laci:* ${formatRupiah(summary.expectedCash)}`);
  out.push(`💵 *Uang Fisik Dihitung:* ${formatRupiah(summary.actualCash)}`);
  out.push(`⚖️ *Selisih:* *${diffLabel}*`);
  out.push(`────────────────`);
  if (summary.notes) {
    out.push(`📝 Catatan: ${summary.notes}`);
    out.push(`────────────────`);
  }
  out.push(`_Dikirim otomatis dari aplikasi POS Kasir_`);

  return out.join("\n");
}

export async function refreshClosedShiftSummary(shiftId: string): Promise<void> {
  const history = (await getMeta<RegisterShift[]>(SHIFT_HISTORY_KEY)) || [];
  const shiftIdx = history.findIndex((s) => s.id === shiftId && s.status === "closed");
  if (shiftIdx === -1) return;
  const shift = history[shiftIdx];
  const summary = await calculateShiftSummary(
    shift,
    shift.actual_cash ?? shift.initial_cash,
    shift.closed_at || undefined,
  );
  history[shiftIdx] = {
    ...shift,
    expected_cash: summary.expectedCash,
    difference: summary.difference,
  };
  await setMeta(SHIFT_HISTORY_KEY, history);
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(POS_SHIFT_HISTORY_KEY, JSON.stringify(history));
    } catch {
      // ignore
    }
  }
}
