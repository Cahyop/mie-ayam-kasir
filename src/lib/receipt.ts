import { formatPlain } from "./format";
import type { ReceiptData } from "./types";

export type ReceiptLine = {
  text: string;
  align?: "left" | "center";
  bold?: boolean;
  large?: boolean;
  doubleHeight?: boolean;
  gapAfter?: boolean;
};

export function receiptCols(paperWidth: "58" | "80"): number {
  return paperWidth === "58" ? 32 : 48;
}

function rule(cols: number): string {
  return "-".repeat(cols);
}

function twoCol(left: string, right: string, cols: number): string {
  const l =
    left.length > cols - right.length - 1 ? left.slice(0, cols - right.length - 2) + "…" : left;
  const spaces = Math.max(1, cols - l.length - right.length);
  return l + " ".repeat(spaces) + right;
}

export function buildReceiptLines(data: ReceiptData, paperWidth: "58" | "80"): ReceiptLine[] {
  const cols = receiptCols(paperWidth);
  const lines: ReceiptLine[] = [];
  const push = (line: ReceiptLine) => lines.push(line);

  push({ text: data.storeName, align: "center", bold: true, large: true });
  if (data.storeAddress) push({ text: data.storeAddress, align: "center" });
  if (data.storePhone) push({ text: `Telp: ${data.storePhone}`, align: "center" });

  push({ text: rule(cols) });

  // Nomor struk di kiri, jam transaksi di kanan (tanpa tanggal)
  const dt = new Date(data.createdAt);
  const timeStr = dt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  push({ text: twoCol(`No: ${data.receiptNo}`, timeStr, cols) });

  if (data.customerName) push({ text: `Pelanggan: ${data.customerName}` });
  push({ text: rule(cols) });

  for (const item of data.items) {
    push({ text: item.name });
    push({
      text: twoCol(
        `  ${formatPlain(item.qty)} x ${formatPlain(item.price)}`,
        formatPlain(item.total),
        cols,
      ),
    });
  }

  push({ text: rule(cols) });
  push({ text: twoCol("Subtotal", formatPlain(data.subtotal), cols) });
  if (data.discount > 0) push({ text: twoCol("Diskon", formatPlain(data.discount), cols) });
  push({
    text: twoCol("TOTAL", formatPlain(data.total), cols),
    bold: true,
    doubleHeight: true,
  });
  push({
    text: twoCol(
      data.paymentMethod === "cash" ? "TUNAI" : "QRIS",
      formatPlain(data.paidAmount),
      cols,
    ),
  });
  if (data.paymentMethod === "cash" && data.changeAmount > 0) {
    push({ text: twoCol("KEMBALI", formatPlain(data.changeAmount), cols) });
  }
  push({ text: rule(cols) });
  if (data.footer) push({ text: data.footer, align: "center" });
  return lines;
}

export function buildWaText(data: ReceiptData): string {
  const dt = new Date(data.createdAt);
  const timeStr = dt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const out: string[] = [];
  out.push(`*${data.storeName}*`);
  out.push(`Struk: ${data.receiptNo} • ${timeStr}`);
  if (data.customerName) out.push(`Pelanggan: ${data.customerName}`);
  out.push("──────────────");
  for (const item of data.items) {
    out.push(`${formatPlain(item.qty)}x ${item.name}`);
    out.push(`   ${formatPlain(item.price)} = ${formatPlain(item.total)}`);
  }
  out.push("──────────────");
  out.push(`Subtotal: Rp ${formatPlain(data.subtotal)}`);
  if (data.discount > 0) out.push(`Diskon: Rp ${formatPlain(data.discount)}`);
  out.push(`*Total: Rp ${formatPlain(data.total)}*`);
  out.push(
    `Bayar: ${data.paymentMethod === "cash" ? "Tunai" : "QRIS"} (Rp ${formatPlain(data.paidAmount)})`,
  );
  if (data.paymentMethod === "cash" && data.changeAmount > 0) {
    out.push(`Kembalian: Rp ${formatPlain(data.changeAmount)}`);
  }
  out.push("──────────────");
  if (data.footer) out.push(data.footer);
  return out.join("\n");
}

export function waHref(text: string, phone?: string | null): string {
  const encoded = encodeURIComponent(text);
  if (phone) {
    const digits = phone.replace(/\D/g, "").replace(/^0/, "62");
    return `https://wa.me/${digits}?text=${encoded}`;
  }
  return `https://api.whatsapp.com/send?text=${encoded}`;
}

export async function renderReceiptImage(
  data: ReceiptData,
  paperWidth: "58" | "80",
): Promise<Blob> {
  const lines = buildReceiptLines(data, paperWidth);
  const cols = receiptCols(paperWidth);
  const width = paperWidth === "58" ? 384 : 576;
  const scale = 2;
  const charW = width / cols;
  const fontPx = charW / 0.6;
  const lineH = fontPx * 1.38;
  const padding = 16;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = Math.ceil((lines.length * lineH + padding * 2) * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111111";
  ctx.textBaseline = "top";

  let y = padding;
  for (const line of lines) {
    const size = line.large ? fontPx * 1.4 : line.doubleHeight ? fontPx * 1.2 : fontPx;
    ctx.font = `${line.bold ? "bold " : ""}${size}px "Courier New", monospace`;
    const textWidth = ctx.measureText(line.text).width;
    const x = line.align === "center" ? Math.max(0, (width - textWidth) / 2) : padding - 6;
    ctx.fillText(line.text, x, y);
    y += line.large ? lineH * 1.25 : lineH;
    if (line.gapAfter) y += lineH * 0.4;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Gagal membuat gambar struk"));
    }, "image/png");
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function shareReceiptImage(
  blob: Blob,
  text: string,
  receiptNo: string,
): Promise<"shared" | "downloaded"> {
  const file = new File([blob], `struk-${receiptNo}.png`, { type: "image/png" });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], text });
    return "shared";
  }
  downloadBlob(blob, `struk-${receiptNo}.png`);
  return "downloaded";
}

export function printBrowserReceipt(data: ReceiptData, paperWidth: "58" | "80") {
  const cols = receiptCols(paperWidth);
  const widthMm = paperWidth === "58" ? 58 : 80;
  const text = buildReceiptLines(data, paperWidth)
    .map((line) => line.text)
    .join("\n");
  const win = window.open("", "_blank", "width=420,height=640");
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>Struk ${data.receiptNo}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 2mm; }
  body { margin: 0; font-family: "Courier New", monospace; font-size: ${paperWidth === "58" ? 12 : 13}px; font-weight: 600; white-space: pre; width: ${widthMm - 6}mm; }
</style></head><body>${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string)}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}
