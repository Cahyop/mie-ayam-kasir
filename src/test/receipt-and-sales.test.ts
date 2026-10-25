import { describe, expect, it } from "vitest";
import { buildReceiptLines, buildWaText, waHref, receiptCols } from "@/lib/receipt";
import { formatRupiah, formatPlain, makeReceiptNo } from "@/lib/format";
import { getNextReceiptNo } from "@/lib/sales";
import { buildShiftReceiptLines, buildShiftWaText } from "@/lib/shift";
import { db, resetTransactionData } from "@/lib/db";
import type { ReceiptData, ShiftSummary } from "@/lib/types";

describe("Receipt and format helpers", () => {
  const dummyReceipt: ReceiptData = {
    receiptNo: "TX-20261025-001",
    createdAt: "2026-10-25T11:00:00.000Z",
    storeName: "Mie Ayam Berkah",
    storeAddress: "Jl. Merdeka No. 10",
    storePhone: "08123456789",
    footer: "Terima kasih, silakan berkunjung kembali!",
    items: [
      { name: "Mie Ayam Pangsit", qty: 2, price: 15000, total: 30000 },
      { name: "Es Teh Manis", qty: 2, price: 5000, total: 10000 },
    ],
    subtotal: 40000,
    discount: 5000,
    total: 35000,
    paymentMethod: "cash",
    paidAmount: 50000,
    changeAmount: 15000,
    customerName: "Mas Joko",
  };

  it("calculates receipt columns correctly for 58mm and 80mm", () => {
    expect(receiptCols("58")).toBe(32);
    expect(receiptCols("80")).toBe(48);
  });

  it("generates proper receipt lines for thermal printer with receipt number and time on the same line", () => {
    const lines58 = buildReceiptLines(dummyReceipt, "58");
    expect(lines58.length).toBeGreaterThan(5);

    const texts = lines58.map((l) => l.text);
    expect(texts).toContain("Mie Ayam Berkah");
    expect(texts).toContain("Jl. Merdeka No. 10");
    expect(texts).toContain("Telp: 08123456789");

    // Receipt number and time are on the same line
    const receiptLine = texts.find((t) => t.includes("TX-20261025-001"));
    expect(receiptLine).toBeDefined();
    expect(receiptLine).toMatch(/No:\s+TX-20261025-001/);
    expect(receiptLine).toMatch(/\d{2}[:.]\d{2}/);

    expect(texts).toContain("Pelanggan: Mas Joko");
    expect(texts).toContain("Mie Ayam Pangsit");
    expect(texts).toContain("Es Teh Manis");
    expect(texts.some((t) => t.includes("TOTAL"))).toBe(true);
    expect(texts.some((t) => t.includes("KEMBALI"))).toBe(true);
  });

  it("omits KEMBALI when money is exact (changeAmount = 0)", () => {
    const exactReceipt: ReceiptData = {
      ...dummyReceipt,
      paidAmount: 35000,
      changeAmount: 0,
    };
    const lines = buildReceiptLines(exactReceipt, "58");
    const texts = lines.map((l) => l.text);
    expect(texts.some((t) => t.includes("TOTAL"))).toBe(true);
    expect(texts.some((t) => t.includes("TUNAI"))).toBe(true);
    expect(texts.some((t) => t.includes("KEMBALI"))).toBe(false);

    const waText = buildWaText(exactReceipt);
    expect(waText).not.toContain("Kembalian:");
  });

  it("omits Subtotal when there is no discount (discount = 0)", () => {
    const noDiscountReceipt: ReceiptData = {
      ...dummyReceipt,
      discount: 0,
      total: 40000,
    };
    const lines = buildReceiptLines(noDiscountReceipt, "58");
    const texts = lines.map((l) => l.text);
    expect(texts.some((t) => t.includes("Subtotal"))).toBe(false);
    expect(texts.some((t) => t.includes("Diskon"))).toBe(false);
    expect(texts.some((t) => t.includes("TOTAL"))).toBe(true);

    const waText = buildWaText(noDiscountReceipt);
    expect(waText).not.toContain("Subtotal:");
    expect(waText).not.toContain("Diskon:");
    expect(waText).toContain("*Total: Rp 40.000*");
  });

  it("formats WhatsApp receipt text correctly", () => {
    const waText = buildWaText(dummyReceipt);
    expect(waText).toContain("*Mie Ayam Berkah*");
    expect(waText).toContain("TX-20261025-001");
    expect(waText).toContain("Pelanggan: Mas Joko");
    expect(waText).toContain("2x Mie Ayam Pangsit");
    expect(waText).toContain("Subtotal: Rp 40.000");
    expect(waText).toContain("Diskon: Rp 5.000");
    expect(waText).toContain("*Total: Rp 35.000*");
    expect(waText).toContain("Kembalian: Rp 15.000");
  });

  it("builds correct WhatsApp href with Indonesian phone normalization", () => {
    const text = "Halo dari Mie Ayam";
    const href1 = waHref(text, "08123456789");
    expect(href1).toBe("https://wa.me/628123456789?text=Halo%20dari%20Mie%20Ayam");

    const href2 = waHref(text, "+62 812-3456-789");
    expect(href2).toBe("https://wa.me/628123456789?text=Halo%20dari%20Mie%20Ayam");

    const hrefNoPhone = waHref(text);
    expect(hrefNoPhone).toContain("api.whatsapp.com/send?text=");
  });

  it("formats currency accurately and generates sequential receipt numbers", async () => {
    expect(formatRupiah(15000)).toBe("Rp 15.000");
    expect(formatPlain(15000)).toBe("15.000");

    // Sequential receipt numbers
    const fixedDate = new Date("2026-10-25T12:00:00Z");
    expect(makeReceiptNo(1, fixedDate)).toBe("R20261025-0001");
    expect(makeReceiptNo(2, fixedDate)).toBe("R20261025-0002");
    expect(makeReceiptNo(42, fixedDate)).toBe("R20261025-0042");
    expect(makeReceiptNo(100, fixedDate)).toBe("R20261025-0100");

    const nextNo = await getNextReceiptNo(fixedDate);
    expect(nextNo).toMatch(/^R20261025-\d{4}$/);
  });

  it("generates valid closing shift receipt lines and WhatsApp message", () => {
    const dummySummary: ShiftSummary = {
      shiftId: "shift-001",
      openedAt: "2026-10-25T08:00:00.000Z",
      closedAt: "2026-10-25T20:00:00.000Z",
      initialCash: 100000,
      cashSales: 450000,
      cashTxCount: 25,
      qrisSales: 150000,
      qrisTxCount: 10,
      totalSales: 600000,
      totalTxCount: 35,
      cashIn: 0,
      cashOut: 25000,
      expectedCash: 525000,
      actualCash: 525000,
      difference: 0,
      notes: "Sisa receh aman",
    };

    const lines = buildShiftReceiptLines(dummySummary, "Mie Ayam Berkah", "58");
    const texts = lines.map((l) => l.text);
    expect(texts).toContain("Mie Ayam Berkah");
    expect(texts).toContain("LAPORAN CLOSING KASIR");
    expect(texts.some((t) => t.includes("Modal Awal") && t.includes("100.000"))).toBe(true);
    expect(texts.some((t) => t.includes("Jual Tunai (25)") && t.includes("450.000"))).toBe(true);
    expect(texts.some((t) => t.includes("Jual QRIS (10)") && t.includes("150.000"))).toBe(true);
    expect(texts.some((t) => t.includes("TOTAL OMSET (35)") && t.includes("600.000"))).toBe(true);
    expect(texts.some((t) => t.includes("SELISIH KAS") && t.includes("PAS"))).toBe(true);

    const waText = buildShiftWaText(dummySummary, "Mie Ayam Berkah");
    expect(waText).toContain("*LAPORAN CLOSING KASIR*");
    expect(waText).toContain("*Mie Ayam Berkah*");
    expect(waText).toContain("Modal Awal:* Rp 100.000");
    expect(waText).toContain("Total Omset:* Rp 600.000 (35 nota)");
    expect(waText).toContain("Selisih:* *PAS (Rp 0)*");
  });

  it("resets transaction data while preserving products and settings", async () => {
    // Seed dummy product and transaction
    await db.products.put({
      id: "prod-reset-test",
      user_id: "test",
      name: "Mie Ayam Pangsit Test",
      category: "Makanan",
      price: 15000,
      stock: 50,
      track_stock: true,
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await db.transactions.put({
      id: "tx-reset-test",
      user_id: "test",
      receipt_no: "R20261025-0001",
      customer_id: null,
      payment_method: "cash",
      subtotal: 15000,
      discount: 0,
      total: 15000,
      paid_amount: 15000,
      change_amount: 0,
      note: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    expect(await db.products.count()).toBeGreaterThan(0);
    expect(await db.transactions.count()).toBeGreaterThan(0);

    await resetTransactionData();

    // Transactions cleared, products preserved!
    expect(await db.transactions.count()).toBe(0);
    expect(await db.products.count()).toBeGreaterThan(0);
  });
});
