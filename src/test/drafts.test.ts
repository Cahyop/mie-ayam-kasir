import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../lib/db";
import {
  saveDraftOrder,
  deleteDraftOrder,
  getDraftOrder,
  getDraftOrders,
  formatTimeAgo,
} from "../lib/drafts";
import { buildReceiptLines, buildWaText } from "../lib/receipt";
import type { CartItem, ReceiptData } from "../lib/types";

describe("Draft Orders (Pesanan Aktif)", () => {
  beforeEach(async () => {
    await db.draft_orders.clear();
  });

  it("berhasil menyimpan draft pesanan baru", async () => {
    const items: CartItem[] = [
      { product_id: "p1", name: "Mie Ayam Original", price: 15000, qty: 2, order_type: "dine_in" },
      { product_id: "p2", name: "Es Teh Manis", price: 5000, qty: 2, order_type: "dine_in" },
    ];

    const draft = await saveDraftOrder({
      tableNo: "Meja 3",
      customerName: "Mas Budi",
      customerId: null,
      note: "Pedas sedang",
      items,
      orderType: "dine_in",
    });

    expect(draft.id).toBeDefined();
    expect(draft.table_no).toBe("Meja 3");
    expect(draft.customer_name).toBe("Mas Budi");
    expect(draft.items.length).toBe(2);
    expect(draft.order_type).toBe("dine_in");

    const saved = await getDraftOrder(draft.id);
    expect(saved).toBeDefined();
    expect(saved?.table_no).toBe("Meja 3");
  });

  it("berhasil memperbarui draft pesanan yang ada (misal tambah pesanan)", async () => {
    const items: CartItem[] = [
      { product_id: "p1", name: "Mie Ayam Original", price: 15000, qty: 2, order_type: "dine_in" },
    ];

    const draft = await saveDraftOrder({
      tableNo: "Meja 1",
      items,
    });

    // Tambah 1 Es Teh
    const updatedItems: CartItem[] = [
      ...items,
      { product_id: "p2", name: "Es Teh Manis", price: 5000, qty: 1, order_type: "dine_in" },
    ];

    const updated = await saveDraftOrder({
      id: draft.id,
      tableNo: "Meja 1",
      items: updatedItems,
    });

    expect(updated.id).toBe(draft.id);
    expect(updated.items.length).toBe(2);
    expect(updated.items.reduce((s, i) => s + i.qty, 0)).toBe(3);

    const all = await getDraftOrders();
    expect(all.length).toBe(1);
    expect(all[0].items.length).toBe(2);
  });

  it("berhasil menghapus / membatalkan draft pesanan", async () => {
    const draft = await saveDraftOrder({
      tableNo: "Meja 5",
      items: [{ product_id: "p1", name: "Mie Ayam", price: 15000, qty: 1 }],
    });

    await deleteDraftOrder(draft.id);
    const saved = await getDraftOrder(draft.id);
    expect(saved).toBeUndefined();
  });

  it("formatTimeAgo menampilkan waktu relatif yang benar", () => {
    const now = new Date().toISOString();
    expect(formatTimeAgo(now)).toBe("Baru saja");

    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(formatTimeAgo(tenMinsAgo)).toBe("10 mnt lalu");

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatTimeAgo(twoHoursAgo)).toBe("2 jam lalu");
  });

  it("buildReceiptLines dan buildWaText memformat Bill Sementara dengan benar", () => {
    const data: ReceiptData = {
      receiptNo: "Meja 2",
      createdAt: new Date().toISOString(),
      storeName: "Mie Ayam Barokah",
      storeAddress: "Jl. Mawar No. 10",
      storePhone: "08123456789",
      footer: "Terima Kasih",
      items: [
        { name: "Mie Ayam Original", qty: 2, price: 15000, total: 30000, orderType: "dine_in" },
        { name: "Es Teh", qty: 2, price: 5000, total: 10000, orderType: "dine_in" },
      ],
      subtotal: 40000,
      discount: 0,
      total: 40000,
      paymentMethod: "cash",
      paidAmount: 0,
      changeAmount: 0,
      customerName: "Pak Joko",
      orderType: "dine_in",
      isDraft: true,
      tableNo: "Meja 2",
    };

    const lines58 = buildReceiptLines(data, "58");
    const fullText = lines58.map((l) => l.text).join("\n");

    expect(fullText).toContain("BILL SEMENTARA (BELUM LUNAS)");
    expect(fullText).toContain("Meja: Meja 2");
    expect(fullText).toContain("Belum Lunas");
    expect(fullText).not.toContain("TUNAI");

    const waText = buildWaText(data);
    expect(waText).toContain("*BILL SEMENTARA (BELUM LUNAS)*");
    expect(waText).toContain("Meja: Meja 2");
    expect(waText).toContain("Belum Lunas");
  });
});
