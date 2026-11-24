import { round2 } from "@/lib/utils";
import {
  db,
  type PaymentLocal,
  type ProductRow,
  type SaleRow,
  type ShiftRow,
  type StaffRow,
} from "@/pos/db";
import { enqueueEventInTx } from "@/pos/outbox";

export type CartLine = {
  productId: string;
  code: string;
  name: string;
  unitPrice: number;
  isvRate: number;
  qty: number;
};

export type OrderType = "comer_aqui" | "para_llevar";

export type PaymentInput = {
  method: "efectivo" | "transferencia";
  amount: number;
  cashReceived?: number;
  transferReference?: string;
};

export function addItem(lines: CartLine[], product: ProductRow): CartLine[] {
  const existe = lines.find((l) => l.productId === product.id);
  if (existe) return setQty(lines, product.id, existe.qty + 1);
  return [
    ...lines,
    {
      productId: product.id,
      code: product.code,
      name: product.name,
      unitPrice: product.price,
      isvRate: product.isvRate,
      qty: 1,
    },
  ];
}

export function removeItem(lines: CartLine[], productId: string): CartLine[] {
  return lines.filter((l) => l.productId !== productId);
}

/** Cantidad entera; 0 o menos quita la línea. */
export function setQty(lines: CartLine[], productId: string, qty: number): CartLine[] {
  const q = Math.trunc(qty);
  if (q <= 0) return removeItem(lines, productId);
  return lines.map((l) => (l.productId === productId ? { ...l, qty: q } : l));
}

export function lineTotal(line: CartLine): number {
  return round2(line.unitPrice * line.qty);
}

/** ISV por línea, igual que app.ev_venta: base = round2(total / (1 + tasa)), isv = total − base. */
export function cartTotals(lines: CartLine[]): { total: number; base: number; isv: number } {
  let total = 0;
  let base = 0;
  for (const l of lines) {
    const t = lineTotal(l);
    total += t;
    base += round2(t / (1 + l.isvRate));
  }
  total = round2(total);
  base = round2(base);
  return { total, base, isv: round2(total - base) };
}

export function cashChange(total: number, received: number): number {
  return round2(Math.max(0, received - total));
}

/** null si los pagos son válidos; si no, el motivo para mostrar en pantalla. */
export function validatePayments(total: number, payments: PaymentInput[]): string | null {
  if (payments.length === 0) return "Agregue un pago";
  for (const p of payments) {
    if (!(p.amount > 0)) return "Cada pago debe ser mayor que cero";
    if (p.method === "efectivo" && !((p.cashReceived ?? 0) >= p.amount)) {
      return "El efectivo recibido no cubre el monto";
    }
    if (p.method === "transferencia" && (p.transferReference ?? "").trim().length < 4) {
      return "La transferencia requiere referencia (4 o más caracteres)";
    }
  }
  const suma = round2(payments.reduce((s, p) => s + p.amount, 0));
  if (suma !== round2(total)) return "La suma de los pagos no coincide con el total";
  return null;
}

export function formatReceiptCode(n: number): string {
  return `R-${String(n).padStart(8, "0")}`;
}

export async function registerSale(input: {
  cart: CartLine[];
  orderType: OrderType;
  payments: PaymentInput[];
  cashier: StaffRow;
  shift: ShiftRow;
}): Promise<SaleRow> {
  const { cart, orderType, payments, cashier, shift } = input;
  if (cart.length === 0) throw new Error("La venta está vacía");
  const { total, isv } = cartTotals(cart);
  const error = validatePayments(total, payments);
  if (error) throw new Error(error);

  const pagos: PaymentLocal[] = payments.map((p) => ({
    paymentId: crypto.randomUUID(),
    method: p.method,
    amount: round2(p.amount),
    ...(p.method === "efectivo"
      ? {
          cashReceived: round2(p.cashReceived ?? p.amount),
          change: cashChange(p.amount, p.cashReceived ?? p.amount),
        }
      : { transferReference: (p.transferReference ?? "").trim() }),
  }));

  return db.transaction("rw", [db.meta, db.sales, db.outbox], async () => {
    const last = ((await db.meta.get("lastReceiptNumber"))?.value as number | undefined) ?? 0;
    const receiptNumber = last + 1;
    await db.meta.put({ key: "lastReceiptNumber", value: receiptNumber });
    const sale: SaleRow = {
      id: crypto.randomUUID(),
      receiptNumber,
      receiptCode: formatReceiptCode(receiptNumber),
      shiftId: shift.id,
      cashierId: cashier.id,
      orderType,
      lines: cart.map((l) => ({
        productId: l.productId,
        code: l.code,
        name: l.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: lineTotal(l),
      })),
      payments: pagos,
      total,
      isv,
      createdAt: new Date().toISOString(),
      status: "registrada",
    };
    await db.sales.add(sale);
    await enqueueEventInTx("venta", cashier.id, {
      sale_id: sale.id,
      receipt_number: receiptNumber,
      shift_id: shift.id,
      order_type: orderType,
      total,
      lines: sale.lines.map((l) => ({
        product_id: l.productId,
        qty: l.qty,
        unit_price: l.unitPrice,
      })),
      payments: pagos.map((p) => ({
        payment_id: p.paymentId,
        method: p.method,
        amount: p.amount,
        ...(p.method === "efectivo"
          ? { cash_received: p.cashReceived }
          : { transfer_reference: p.transferReference }),
      })),
    });
    return sale;
  });
}
