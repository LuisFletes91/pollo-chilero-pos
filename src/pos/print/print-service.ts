import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { db, getMeta, type SaleRow } from "@/pos/db";
import { enqueueEvent } from "@/pos/outbox";
import { encodeLines } from "@/pos/print/escpos";
import { buildReceiptLines } from "@/pos/print/receipt";
import { ReceiptPrintView } from "@/pos/print/ReceiptPrintView";
import { getRememberedPort, isWebSerialSupported, writeBytes } from "@/pos/print/serial";

export type PrintMode = "serial" | "navegador";
type PrinterSetting = { modo?: PrintMode; baudios?: number };

async function printerSetting(): Promise<PrinterSetting> {
  const row = await db.settings.get("printer");
  return (row?.value as PrinterSetting | undefined) ?? { modo: "navegador" };
}

async function receiptLines(sale: SaleRow, copy: boolean): Promise<string[]> {
  const cajero = await db.staff.get(sale.cashierId);
  const caja = (await getMeta<string>("deviceLabel")) ?? "";
  return buildReceiptLines(sale, {
    copy,
    cashierName: cajero?.displayName ?? "",
    deviceLabel: caja,
  });
}

function printInBrowser(lines: string[]): void {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(createElement(ReceiptPrintView, { lines })));
  try {
    window.print();
  } finally {
    root.unmount();
    host.remove();
  }
}

/**
 * Imprime el recibo. Con `serial` y un puerto recordado envía ESC/POS con corte y SIN pulso de gaveta
 * (la gaveta se abre a mano); si falla o no hay Web Serial, usa window.print(). Devuelve el modo usado.
 */
export async function printSale(sale: SaleRow, opts: { copy: boolean }): Promise<PrintMode> {
  const lines = await receiptLines(sale, opts.copy);
  const setting = await printerSetting();
  if (setting.modo === "serial" && isWebSerialSupported()) {
    try {
      const port = await getRememberedPort();
      if (port) {
        await writeBytes(port, encodeLines(lines, { cut: true }), setting.baudios ?? 9600);
        return "serial";
      }
    } catch {
      // se cae al navegador
    }
  }
  printInBrowser(lines);
  return "navegador";
}

/** Reimprime como COPIA y deja constancia con el evento `reimpresion`. */
export async function reprintSale(
  sale: SaleRow,
  actorId: string = sale.cashierId,
): Promise<PrintMode> {
  const modo = await printSale(sale, { copy: true });
  await enqueueEvent("reimpresion", actorId, { reprint_id: crypto.randomUUID(), sale_id: sale.id });
  return modo;
}
