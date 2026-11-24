import { formatLempiras, toLocalHN } from "@/lib/utils";
import type { SaleRow } from "@/pos/db";

export const RECEIPT_COLUMNS = 48;
const W = RECEIPT_COLUMNS;
const SEP = "-".repeat(W);

export type ReceiptContext = { copy: boolean; cashierName: string; deviceLabel: string };

export function center(text: string): string {
  const t = text.slice(0, W);
  return " ".repeat(Math.floor((W - t.length) / 2)) + t;
}

/** Texto a la izquierda y monto a la derecha; recorta el texto para no pasar de 48. */
export function leftRight(left: string, right: string): string {
  const max = W - right.length - 1;
  const l = left.length > max ? left.slice(0, max) : left;
  return l + " ".repeat(W - l.length - right.length) + right;
}

const PEDIDO = { comer_aqui: "Comer aquí", para_llevar: "Para llevar" } as const;

export function buildReceiptLines(sale: SaleRow, ctx: ReceiptContext): string[] {
  const { fecha, hora } = toLocalHN(sale.createdAt);
  const lines: string[] = [];
  if (ctx.copy) lines.push(center("*** COPIA ***"));
  lines.push(
    center("POLLO CHILERO"),
    center("Orgullo Catracho"),
    center("Aldea El Ocotal, Olanchito, Yoro"),
    center("RECIBO DE VENTA"),
    `No.: ${sale.receiptCode}`,
    leftRight(`Fecha: ${fecha}  ${hora}`, `Caja: ${ctx.deviceLabel}`),
    `Cajero: ${ctx.cashierName}`.slice(0, W),
    `Pedido: ${PEDIDO[sale.orderType]}`,
    SEP,
  );
  for (const l of sale.lines) {
    lines.push(leftRight(`${l.qty} x ${l.name}`, formatLempiras(l.lineTotal)));
  }
  lines.push(
    SEP,
    leftRight("TOTAL", formatLempiras(sale.total)),
    leftRight("ISV incluido", formatLempiras(sale.isv)),
  );
  for (const p of sale.payments) {
    if (p.method === "efectivo") {
      lines.push(leftRight("Efectivo", formatLempiras(p.amount)));
      const recibido = p.cashReceived ?? p.amount;
      lines.push(leftRight("Recibido", formatLempiras(recibido)));
      lines.push(leftRight("Cambio", formatLempiras(p.change ?? Math.max(0, recibido - p.amount))));
    } else {
      lines.push(leftRight("Transferencia", formatLempiras(p.amount)));
      lines.push(`Ref.: ${p.transferReference ?? ""}`.slice(0, W));
    }
  }
  lines.push(SEP, center("Este documento no es una factura"), center("¡Gracias por su compra!"));
  if (ctx.copy) lines.push(center("*** COPIA ***"));
  return lines;
}
