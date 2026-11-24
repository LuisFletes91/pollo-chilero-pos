// Tipos mínimos propios de Web Serial: no dependemos de los tipos DOM (no están en lib.dom estable).
export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly writable: WritableStream<Uint8Array> | null;
}

interface SerialLike {
  requestPort(options?: object): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

function serial(): SerialLike | undefined {
  if (typeof navigator === "undefined" || !("serial" in navigator)) return undefined;
  return (navigator as unknown as { serial: SerialLike }).serial;
}

export function isWebSerialSupported(): boolean {
  return serial() !== undefined;
}

/** Requiere un gesto del usuario (clic). */
export async function requestPrinterPort(): Promise<SerialPortLike> {
  const s = serial();
  if (!s) throw new Error("SIN_WEB_SERIAL: este navegador no soporta Web Serial");
  return s.requestPort();
}

export async function getRememberedPort(): Promise<SerialPortLike | null> {
  const s = serial();
  if (!s) return null;
  const ports = await s.getPorts();
  return ports[0] ?? null;
}

export async function writeBytes(
  port: SerialPortLike,
  bytes: Uint8Array,
  baudRate = 9600,
): Promise<void> {
  if (!port.writable) {
    await port.open({ baudRate });
  }
  const writable = port.writable;
  if (!writable)
    throw new Error("PUERTO_NO_ESCRIBIBLE: no se pudo abrir el puerto de la impresora");
  const writer = writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}
