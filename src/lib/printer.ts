import { buildReceiptLines } from "./receipt";
import type { ReceiptData, ReceiptLine } from "./types";

const PRINTER_SERVICE = "000018f0-0000-1000-8000-00805f9b34fb";
const WRITE_CHARACTERISTIC = "00002af1-0000-1000-8000-00805f9b34fb";

export type PrinterConnection = {
  deviceName: string;
  print: (bytes: Uint8Array) => Promise<void>;
  disconnect: () => void;
};

const PRINTER_NAME_KEY = "pos_printer_name";
const KEEP_CONNECTED_KEY = "pos_printer_keep_connected";

// In-memory active connection cache
let cachedDevice: BluetoothDevice | null = null;
let cachedCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
const statusListeners = new Set<(connected: boolean, deviceName: string | null) => void>();

export function isKeepConnectedEnabled(): boolean {
  try {
    const val = localStorage.getItem(KEEP_CONNECTED_KEY);
    return val !== "false"; // Default true: keep connected!
  } catch {
    return true;
  }
}

export function setKeepConnectedEnabled(enabled: boolean) {
  try {
    localStorage.setItem(KEEP_CONNECTED_KEY, enabled ? "true" : "false");
  } catch {
    // ignore
  }
}

export function bluetoothPrintingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "bluetooth" in navigator &&
    !!(navigator as Navigator & { bluetooth?: unknown }).bluetooth
  );
}

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

export function isPrinterConnected(): boolean {
  return Boolean(cachedDevice?.gatt?.connected && cachedCharacteristic);
}

export function getConnectedDeviceName(): string | null {
  if (isPrinterConnected() && cachedDevice) {
    return cachedDevice.name ?? "Printer Bluetooth";
  }
  return null;
}

export function subscribePrinterStatus(
  fn: (connected: boolean, deviceName: string | null) => void,
): () => void {
  statusListeners.add(fn);
  fn(isPrinterConnected(), getConnectedDeviceName() || getSavedPrinterName());
  return () => statusListeners.delete(fn);
}

function notifyStatus() {
  const connected = isPrinterConnected();
  const name = connected ? getConnectedDeviceName() : getSavedPrinterName();
  statusListeners.forEach((fn) => fn(connected, name));
}

async function writeChunks(characteristic: BluetoothRemoteGATTCharacteristic, bytes: Uint8Array) {
  const CHUNK = 180;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    await characteristic.writeValue(bytes.slice(i, i + CHUNK));
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function attachDevice(device: BluetoothDevice): Promise<PrinterConnection> {
  cachedDevice = device;

  const onDisconnected = () => {
    cachedCharacteristic = null;
    notifyStatus();
    // Auto-reconnect if keep-connected is active
    if (isKeepConnectedEnabled() && cachedDevice) {
      setTimeout(async () => {
        try {
          if (cachedDevice && !cachedDevice.gatt?.connected) {
            await reconnectDevice(cachedDevice);
          }
        } catch {
          // ignore auto-reconnect background error
        }
      }, 2000);
    }
  };

  device.removeEventListener("gattserverdisconnected", onDisconnected);
  device.addEventListener("gattserverdisconnected", onDisconnected);

  const characteristic = await reconnectDevice(device);
  const deviceName = device.name ?? "Printer Bluetooth";
  savePrinterName(deviceName);
  notifyStatus();

  return {
    deviceName,
    print: async (bytes) => {
      let char = cachedCharacteristic;
      if (!cachedDevice?.gatt?.connected || !char) {
        char = await reconnectDevice(cachedDevice || device);
      }
      await writeChunks(char, bytes);
    },
    disconnect: () => {
      disconnectPrinter();
    },
  };
}

async function reconnectDevice(
  device: BluetoothDevice,
): Promise<BluetoothRemoteGATTCharacteristic> {
  const server = await device.gatt!.connect();
  const service = await server.getPrimaryService(PRINTER_SERVICE);
  const characteristic = await service.getCharacteristic(WRITE_CHARACTERISTIC);
  cachedCharacteristic = characteristic;
  notifyStatus();
  return characteristic;
}

export function disconnectPrinter() {
  if (cachedDevice?.gatt?.connected) {
    cachedDevice.gatt.disconnect();
  }
  cachedDevice = null;
  cachedCharacteristic = null;
  notifyStatus();
}

/**
 * Gets the current active connection or requests a new pairing from user.
 */
export async function connectPrinter(forceNew = false): Promise<PrinterConnection> {
  // If we already have an active connected device and user doesn't force re-pairing
  if (!forceNew && cachedDevice?.gatt?.connected && cachedCharacteristic) {
    return {
      deviceName: cachedDevice.name ?? "Printer Bluetooth",
      print: async (bytes) => {
        await writeChunks(cachedCharacteristic!, bytes);
      },
      disconnect: disconnectPrinter,
    };
  }

  // If we have a cached device whose connection dropped, try reconnecting without dialog
  if (!forceNew && cachedDevice) {
    try {
      const char = await reconnectDevice(cachedDevice);
      return {
        deviceName: cachedDevice.name ?? "Printer Bluetooth",
        print: async (bytes) => {
          await writeChunks(char, bytes);
        },
        disconnect: disconnectPrinter,
      };
    } catch {
      // Reconnection failed, fallback to requestDevice
    }
  }

  // Check if browser has persistent getDevices permission (Chrome Web Bluetooth)
  if (!forceNew && typeof navigator !== "undefined" && "bluetooth" in navigator) {
    const navBt = (
      navigator as Navigator & {
        bluetooth: { getDevices?: () => Promise<BluetoothDevice[]> };
      }
    ).bluetooth;
    if (navBt.getDevices) {
      try {
        const permitted = await navBt.getDevices();
        const savedName = getSavedPrinterName();
        const match = permitted.find((d) => d.name === savedName) || permitted[0];
        if (match) {
          return await attachDevice(match);
        }
      } catch {
        // Fall back to requestDevice
      }
    }
  }

  // Show browser bluetooth device picker
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

  return await attachDevice(device);
}

export async function buildEscposBytes(
  data: ReceiptData,
  paperWidth: "58" | "80",
): Promise<Uint8Array> {
  const lines: ReceiptLine[] = buildReceiptLines(data, paperWidth);
  const chunks: number[] = [];
  const encoder = new TextEncoder();

  // ESC @ — Initialize printer
  chunks.push(0x1b, 0x40);

  // ESC M 0 — Explicitly select Font A (12x24 dots: larger, bolder, crisp lines, fills 384 dots)
  chunks.push(0x1b, 0x4d, 0x00);

  // ESC 2 — Set standard line spacing
  chunks.push(0x1b, 0x32);

  for (const line of lines) {
    // ESC a n — Justification (0: left, 1: center)
    chunks.push(0x1b, 0x61, line.align === "center" ? 0x01 : 0x00);

    // ESC E n — Emphasized / Bold
    // ESC G n — Double strike (darker print on thermal head)
    if (line.bold) {
      chunks.push(0x1b, 0x45, 0x01, 0x1b, 0x47, 0x01);
    } else {
      chunks.push(0x1b, 0x45, 0x00, 0x1b, 0x47, 0x00);
    }

    // GS ! n — Character size
    // 0x11 = double width & height (Store Name)
    // 0x01 = double height (TOTAL)
    // 0x00 = standard Font A
    const charSize = line.large ? 0x11 : line.doubleHeight ? 0x01 : 0x00;
    chunks.push(0x1d, 0x21, charSize);

    chunks.push(...encoder.encode(line.text));
    chunks.push(0x0a);

    // Reset styles after line so it never bleeds into next line
    if (line.bold) {
      chunks.push(0x1b, 0x45, 0x00, 0x1b, 0x47, 0x00);
    }
    if (charSize !== 0x00) {
      chunks.push(0x1d, 0x21, 0x00);
    }
    if (line.gapAfter) {
      chunks.push(0x0a);
    }
  }

  // Footer feed:
  // For 58mm portable printers (manual tear bar): feed just 2 lines so the text clears the cutter cleanly without wasting 5cm of paper!
  chunks.push(0x0a, 0x0a);

  // For 80mm printers with auto-cutter:
  if (paperWidth === "80") {
    chunks.push(0x0a, 0x1d, 0x56, 0x42, 0x00); // GS V 66 0 (partial cut)
  }

  return new Uint8Array(chunks);
}

/**
 * Prints to Bluetooth printer and KEEPS CONNECTION ALIVE so next prints are instantaneous.
 */
export async function printViaBluetooth(
  data: ReceiptData,
  paperWidth: "58" | "80",
): Promise<string> {
  const connection = await connectPrinter();
  try {
    const bytes = await buildEscposBytes(data, paperWidth);
    await connection.print(bytes);
    // If keep-connected is false, disconnect immediately
    if (!isKeepConnectedEnabled()) {
      connection.disconnect();
    }
    return connection.deviceName;
  } catch (error) {
    // If printing failed because connection dropped, clear characteristic
    cachedCharacteristic = null;
    notifyStatus();
    throw error;
  }
}
