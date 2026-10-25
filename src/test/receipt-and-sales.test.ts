import { describe, expect, it } from "vitest";
import { buildReceiptLines, buildWaText, waHref, receiptCols } from "@/lib/receipt";
import { formatRupiah, formatPlain, makeReceiptNo } from "@/lib/format";
import { getNextReceiptNo } from "@/lib/sales";
import type { ReceiptData } from "@/lib/types";

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
});
