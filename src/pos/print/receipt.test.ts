import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, setMeta, type PaymentLocal, type SaleRow } from "@/pos/db";
import { printSale, reprintSale } from "@/pos/print/print-service";
import { buildReceiptLines, RECEIPT_COLUMNS } from "@/pos/print/receipt";

function venta(opts: { total?: number; payments?: PaymentLocal[] } = {}): SaleRow {
  const total = opts.total ?? 209;
  return {
    id: "v1",
    receiptNumber: 1,
    receiptCode: "R-00000001",
    shiftId: "t1",
    cashierId: "c1",
    orderType: "comer_aqui",
    lines: [
      {
        productId: "p-cf001",
        code: "CF-001",
        name: "2 muslos + 1 pierna + 1 ala + 1 papa + 1 refresco",
        qty: 1,
        unitPrice: total,
        lineTotal: total,
      },
    ],
    payments: opts.payments ?? [
      { paymentId: "pg1", method: "efectivo", amount: total, cashReceived: 300, change: 91 },
    ],
    total,
    isv: 27.26,
    createdAt: "2026-11-22T16:00:00.000Z",
    status: "registrada",
  };
}

const ctx = { copy: false, cashierName: "Ana", deviceLabel: "Caja 1" };

/** Simula Web Serial con un puerto recordado que guarda los bytes escritos. */
function simularSerial(): Uint8Array[] {
  const escritos: Uint8Array[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      escritos.push(chunk);
    },
  });
  const port = { open: vi.fn(), close: vi.fn(), writable };
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: { requestPort: vi.fn(), getPorts: () => Promise.resolve([port]) },
  });
  return escritos;
}

function contienePulso(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0x1b && bytes[i + 1] === 0x70) return true;
  }
  return false;
}

let impreso: string[];
let printSpy: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.staff.put({
    id: "c1",
    displayName: "Ana",
    role: "cajero",
    pinSalt: "x",
    pinHash: "x",
    pinIterations: 100000,
  });
  await setMeta("deviceLabel", "Caja 1");
  impreso = [];
  // Captura lo que está en pantalla para imprimir en el momento de window.print().
  printSpy = vi.fn(() => {
    impreso.push(document.querySelector(".receipt-80mm")?.textContent ?? "");
  });
  window.print = printSpy as unknown as typeof window.print;
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "serial");
});

describe("buildReceiptLines", () => {
  it("contiene los datos de la venta y ninguna línea pasa de 48", () => {
    const lines = buildReceiptLines(venta(), ctx);
    const texto = lines.join("\n");
    for (const esperado of [
      "POLLO CHILERO",
      "RECIBO DE VENTA",
      "R-00000001",
      "Cajero: Ana",
      "Caja: Caja 1",
      "Comer aquí",
      "2 muslos + 1 pierna",
      "TOTAL",
      "L 209.00",
      "ISV incluido",
      "L 27.26",
      "Efectivo",
      "Recibido",
      "L 300.00",
      "Cambio",
      "L 91.00",
      "Este documento no es una factura",
    ]) {
      expect(texto).toContain(esperado);
    }
    expect(texto).toContain("Fecha: 2026-11-22  10:00");
    expect(texto).not.toContain("*** COPIA ***");
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(RECEIPT_COLUMNS);
  });

  it("pago mixto imprime una línea por forma de pago y la referencia", () => {
    const lines = buildReceiptLines(
      venta({
        payments: [
          { paymentId: "a", method: "efectivo", amount: 150, cashReceived: 150, change: 0 },
          { paymentId: "b", method: "transferencia", amount: 59, transferReference: "BAC-9981" },
        ],
      }),
      { ...ctx, copy: true },
    );
    const texto = lines.join("\n");
    expect(texto).toContain("Transferencia");
    expect(texto).toContain("L 59.00");
    expect(texto).toContain("Ref.: BAC-9981");
    expect(lines[0]?.trim()).toBe("*** COPIA ***");
    expect(lines.at(-1)?.trim()).toBe("*** COPIA ***");
    expect(lines.every((l) => l.length <= RECEIPT_COLUMNS)).toBe(true);
  });

  it("formatea 1234.5 como L 1,234.50", () => {
    const texto = buildReceiptLines(venta({ total: 1234.5 }), ctx).join("\n");
    expect(texto).toContain("L 1,234.50");
  });
});

describe("print-service", () => {
  it("sin Web Serial imprime con window.print una vez usando receipt-80mm", async () => {
    await db.settings.put({ key: "printer", value: { modo: "serial", baudios: 9600 } });
    expect(await printSale(venta(), { copy: false })).toBe("navegador");
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(impreso[0]).toContain("RECIBO DE VENTA");
    expect(document.querySelector(".receipt-80mm")).toBeNull();
  });

  it("en modo navegador usa window.print aunque haya Web Serial", async () => {
    const escritos = simularSerial();
    await db.settings.put({ key: "printer", value: { modo: "navegador" } });
    expect(await printSale(venta(), { copy: false })).toBe("navegador");
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(escritos).toHaveLength(0);
  });

  it("en modo serial envía bytes sin pulso de gaveta, en efectivo y en transferencia", async () => {
    const escritos = simularSerial();
    await db.settings.put({ key: "printer", value: { modo: "serial", baudios: 9600 } });
    expect(await printSale(venta(), { copy: false })).toBe("serial");
    expect(
      await printSale(
        venta({
          payments: [
            { paymentId: "t", method: "transferencia", amount: 209, transferReference: "ABCD" },
          ],
        }),
        { copy: false },
      ),
    ).toBe("serial");
    expect(escritos).toHaveLength(2);
    for (const bytes of escritos) {
      expect(bytes.length).toBeGreaterThan(100);
      expect(contienePulso(bytes)).toBe(false);
    }
    expect(printSpy).not.toHaveBeenCalled();
  });

  it("reimprimir agrega *** COPIA *** y encola un evento reimpresion", async () => {
    await reprintSale(venta(), "s1");
    expect(impreso[0]).toContain("*** COPIA ***");
    const eventos = await db.outbox.toArray();
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.type).toBe("reimpresion");
    expect(eventos[0]?.staffId).toBe("s1");
    expect(eventos[0]?.payload).toMatchObject({ sale_id: "v1" });
  });
});
