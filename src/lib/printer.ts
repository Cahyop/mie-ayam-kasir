import { buildReceiptLines } from "./receipt";
import type { ReceiptData, ReceiptLine } from "./types";

const PRINTER_SERVICE = "000018f0-0000-1000-8000-00805f9b34fb";
const WRITE_CHARACTERISTIC = "00002af1-0000-1000-8000-00805f9b34fb";

export type PrinterConnection = {
  deviceName: string;
  print: (bytes: Uint8Array) => Promise<void>;
  disconnect: () => void;
};

export function bluetoothPrintingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "bluetooth" in navigator &&
    !!(navigator as Navigator & { bluetooth?: unknown }).bluetooth
  );
}

const PRINTER_NAME_KEY = "pos_printer_name";

export function getSavedPrinterName(): string | null {
  try {
    return localStorage.getItem(PRINTER_NAME_KEY);
  } catch {
    return null;
  }
}

function savePrinterName(name: string | null) {
  try {
    if (name) localStorage.setItem(PRINTER_NAME_KEY, name);
    else localStorage.removeItem(PRINTER_NAME_KEY);
  } catch {
    // ignore
  }
}

async function writeChunks(characteristic: BluetoothRemoteGATTCharacteristic, bytes: Uint8Array) {
  const CHUNK = 180;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    await characteristic.writeValue(bytes.slice(i, i + CHUNK));
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function connectPrinter(): Promise<PrinterConnection> {
  const bluetooth = (
    navigator as Navigator & {
      bluetooth: {
        requestDevice: (options: unknown) => Promise<BluetoothDevice>;
      };
    }
  ).bluetooth;

  const device = await bluetooth.requestDevice({
    filters: [{ services: [PRINTER_SERVICE] }],
    optionalServices: [PRINTER_SERVICE],
  });

  const server = await device.gatt!.connect();
  const service = await server.getPrimaryService(PRINTER_SERVICE);
  const characteristic = await service.getCharacteristic(WRITE_CHARACTERISTIC);

  const deviceName = device.name ?? "Printer Bluetooth";
  savePrinterName(deviceName);

  return {
    deviceName,
    print: async (bytes) => {
      if (!device.gatt?.connected) {
        await device.gatt!.connect();
      }
      await writeChunks(characteristic, bytes);
    },
    disconnect: () => {
      device.gatt?.disconnect();
      savePrinterName(null);
    },
  };
}

export async function buildEscposBytes(
  data: ReceiptData,
  paperWidth: "58" | "80",
): Promise<Uint8Array> {
  const lines: ReceiptLine[] = buildReceiptLines(data, paperWidth);
  const chunks: number[] = [];
  const encoder = new TextEncoder();

  // ESC @ — initialize
  chunks.push(0x1b, 0x40);

  for (const line of lines) {
    // ESC a n — justification
    chunks.push(0x1b, 0x61, line.align === "center" ? 0x01 : 0x00);
    // ESC E n — bold
    chunks.push(0x1b, 0x45, line.bold ? 0x01 : 0x00);
    // GS ! n — character size
    chunks.push(0x1d, 0x21, line.large ? 0x11 : 0x00);
    chunks.push(...encoder.encode(line.text));
    chunks.push(0x0a);
    if (line.gapAfter) chunks.push(0x0a, 0x0a);
  }

  // Feed and partial cut
  chunks.push(0x0a, 0x0a, 0x0a, 0x0a);
  chunks.push(0x1d, 0x56, 0x42, 0x00);

  return new Uint8Array(chunks);
}

export async function printViaBluetooth(
  data: ReceiptData,
  paperWidth: "58" | "80",
): Promise<string> {
  const connection = await connectPrinter();
  try {
    const bytes = await buildEscposBytes(data, paperWidth);
    await connection.print(bytes);
    return connection.deviceName;
  } finally {
    connection.disconnect();
  }
}
