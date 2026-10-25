import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../lib/db";
import {
  saveDraftOrder,
  deleteDraftOrder,
  getDraftOrder,
  getDraftOrders,
  formatTimeAgo,
  pullDraftOrdersFromCloud,
} from "../lib/drafts";
import { setSyncUserId } from "../lib/sync";
import { supabase } from "@/integrations/supabase/client";
import { buildReceiptLines, buildWaText } from "../lib/receipt";
import type { CartItem, DraftOrder, ReceiptData } from "../lib/types";

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

  it("pullDraftOrdersFromCloud menarik pesanan pending dari cloud ke IndexedDB perangkat lain", async () => {
    setSyncUserId("user-123");
    const mockDraft: DraftOrder = {
      id: "draft-cloud-1",
      user_id: "user-123",
      table_no: "Meja 4",
      customer_name: "Pak Eko",
      customer_id: null,
      note: "Bungkus 1, Makan 1",
      items: [
        { product_id: "p1", name: "Mie Ayam", price: 15000, qty: 2, order_type: "dine_in" },
      ],
      order_type: "dine_in",
      discount: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: mockDraft.id,
            user_id: "user-123",
            name: "__DRAFT_ORDER__",
            phone: mockDraft.table_no,
            note: JSON.stringify(mockDraft),
            updated_at: mockDraft.updated_at,
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    try {
      const result = await pullDraftOrdersFromCloud();
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("draft-cloud-1");
      expect(result[0].table_no).toBe("Meja 4");

      const inLocalDb = await db.draft_orders.get("draft-cloud-1");
      expect(inLocalDb).toBeDefined();
      expect(inLocalDb?.customer_name).toBe("Pak Eko");
    } finally {
      fetchSpy.mockRestore();
      setSyncUserId(null);
    }
  });

  it("pullDraftOrdersFromCloud membersihkan draft lokal jika sudah dibayar di perangkat lain", async () => {
    setSyncUserId("user-123");
    // Simulasikan perangkat ini punya draft yang sebelumnya disinkronkan
    await db.draft_orders.put({
      id: "draft-paid-elsewhere",
      user_id: "user-123",
      table_no: "Meja 9",
      customer_name: null,
      customer_id: null,
      note: null,
      items: [],
      order_type: "dine_in",
      discount: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      cloud_synced: true,
    });

    // Cloud sudah kosong (sudah dibayar / dibatalkan di device 2)
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    try {
      await pullDraftOrdersFromCloud();

      const localCheck = await db.draft_orders.get("draft-paid-elsewhere");
      expect(localCheck).toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
      setSyncUserId(null);
    }
  });
});
