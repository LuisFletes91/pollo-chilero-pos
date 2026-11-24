import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";

// La gaveta de dinero NO está conectada al sistema y se abre a mano (decisión del usuario 2026-11-23):
// por eso aquí nunca se llama pulse().

export function createEncoder(columns = 48): ReceiptPrinterEncoder {
  return new ReceiptPrinterEncoder({ language: "esc-pos", columns });
}

export function encodeLines(lines: string[], opts: { cut: boolean }): Uint8Array {
  const encoder = createEncoder().initialize().codepage("auto");
  for (const line of lines) {
    encoder.line(line);
  }
  if (opts.cut) {
    encoder.cut("partial");
  }
  return encoder.encode();
}

function fechaLocal(date: Date): string {
  // Honduras: UTC-6 sin horario de verano.
  const hn = new Date(date.getTime() - 6 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(hn.getUTCDate())}/${p(hn.getUTCMonth() + 1)}/${hn.getUTCFullYear()} ${p(hn.getUTCHours())}:${p(hn.getUTCMinutes())}`;
}

export function testTicketLines(now: Date = new Date()): string[] {
  return [
    "POLLO CHILERO",
    "PRUEBA DE IMPRESORA",
    fechaLocal(now),
    "Ñandú áéíóú — L 1,234.50",
    "-".repeat(48),
  ];
}

export function buildTestTicket(now: Date = new Date()): Uint8Array {
  return encodeLines(testTicketLines(now), { cut: true });
}
