import { describe, it, expect, beforeEach } from "vitest";
import { db, setMeta } from "../lib/db";
import {
  openShift,
  closeShift,
  getActiveShift,
  ACTIVE_SHIFT_KEY,
  POS_ACTIVE_SHIFT_KEY,
} from "../lib/shift";
import {
  saveDraftOrder,
  getDraftOrders,
  ensureDraftOrdersRestored,
  POS_DRAFT_ORDERS_KEY,
} from "../lib/drafts";

describe("Shift & Draft Persistence & Recovery", () => {
  beforeEach(async () => {
    await db.cash_flows.clear();
    await db.meta.clear();
    await db.draft_orders.clear();
    localStorage.clear();
  });

  it("mempertahankan active shift di localStorage saat dibuka", async () => {
    const shift = await openShift(100000, "Uang kembalian pagi");
    expect(shift.status).toBe("open");
    expect(shift.initial_cash).toBe(100000);

    const storedInLocal = localStorage.getItem(POS_ACTIVE_SHIFT_KEY);
    expect(storedInLocal).toBeDefined();
    expect(JSON.parse(storedInLocal!).id).toBe(shift.id);

    // Simulasi jika meta di IndexedDB terhapus (misal sesaat setelah logout)
    await db.meta.delete(ACTIVE_SHIFT_KEY);

    // getActiveShift harus memulihkan dari localStorage
    const recovered = await getActiveShift();
    expect(recovered).not.toBeNull();
    expect(recovered?.id).toBe(shift.id);
    expect(recovered?.initial_cash).toBe(100000);
  });

  it("auto-recovery shift dari cash_flows jika meta dan localStorage terhapus", async () => {
    const shift = await openShift(150000, "Modal hari ini");
    expect(shift.initial_cash).toBe(150000);

    // Hapus shift dari meta dan localStorage (simulasi reset cache)
    await db.meta.clear();
    localStorage.removeItem(POS_ACTIVE_SHIFT_KEY);

    // getActiveShift harus berhasil merekonstruksi shift dari cash_flow modal
    const recovered = await getActiveShift();
    expect(recovered).not.toBeNull();
    expect(recovered?.status).toBe("open");
    expect(recovered?.initial_cash).toBe(150000);
  });

  it("tidak auto-recover shift jika shift sudah ditutup (closed)", async () => {
    const shift = await openShift(100000);
    await closeShift(shift, 100000, "Tutup shift");

    const active = await getActiveShift();
    expect(active).toBeNull();
  });

  it("auto-recovery shift dari transaksi penjualan jika modal flow tidak ada tetapi ada transaksi hari ini", async () => {
    // Tidak ada active_shift di meta, tidak ada di localStorage, tidak ada cash_flows modal
    const now = new Date().toISOString();
    await db.transactions.put({
      id: "tx-test-today",
      user_id: "test-user",
      receipt_no: "R20261025-0001",
      customer_id: null,
      payment_method: "cash",
      subtotal: 30000,
      discount: 0,
      total: 30000,
      paid_amount: 30000,
      change_amount: 0,
      note: null,
      created_at: now,
      updated_at: now,
    });

    const active = await getActiveShift();
    expect(active).not.toBeNull();
    expect(active?.status).toBe("open");
    expect(active?.opened_at).toBe(now);
  });

  it("memulihkan draft orders dari backup localStorage jika IndexedDB kosong", async () => {
    await saveDraftOrder({
      tableNo: "Meja 10",
      customerName: "Pelanggan A",
      items: [{ product_id: "p1", name: "Mie Ayam", price: 15000, qty: 2 }],
    });

    const inLocal = localStorage.getItem(POS_DRAFT_ORDERS_KEY);
    expect(inLocal).toBeDefined();

    // Kosongkan IndexedDB
    await db.draft_orders.clear();
    expect(await db.draft_orders.count()).toBe(0);

    // Panggil pemulihan
    const restored = await ensureDraftOrdersRestored();
    expect(restored.length).toBe(1);
    expect(restored[0].table_no).toBe("Meja 10");

    const orders = await getDraftOrders();
    expect(orders.length).toBe(1);
    expect(orders[0].customer_name).toBe("Pelanggan A");
  });
});
