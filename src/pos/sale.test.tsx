import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartTotals,
  registerSale,
  validatePayments,
  type CartLine,
  type PaymentInput,
} from "@/pos/cart";
import { db, type ProductRow, type ShiftRow, type StaffRow } from "@/pos/db";
import { applyKey } from "@/pos/NumPad";
import { SaleScreen } from "@/pos/SaleScreen";

const CATEGORIAS = [
  ["CF", "Combos familiares"],
  ["CP", "Combos personales"],
  ["PZ", "Pollo en piezas"],
  ["CI", "Combos infantiles"],
  ["EX", "Extras"],
  ["BE", "Bebidas"],
] as const;

const PZ001: ProductRow = {
  id: "p-pz001",
  code: "PZ-001",
  name: "4 piezas de pollo",
  categoryCode: "PZ",
  price: 120,
  isvRate: 0.15,
  active: true,
  sortOrder: 1,
};
const BE008: ProductRow = {
  id: "p-be008",
  code: "BE-008",
  name: "12 oz Pepsi, Mirinda, naranja, uva, 7up, Teen",
  categoryCode: "BE",
  price: 13,
  isvRate: 0.15,
  active: true,
  sortOrder: 8,
};

const cajero: StaffRow = {
  id: "c1",
  displayName: "Ana",
  role: "cajero",
  pinSalt: "x",
  pinHash: "x",
  pinIterations: 100000,
};
const turno: ShiftRow = {
  id: "t1",
  cashierId: "c1",
  status: "abierto",
  openedAt: "2026-11-22T14:00:00.000Z",
  openingFloat: { "100": 5 },
  openingTotal: 500,
  approvedBy: "s1",
};

const linea = (p: ProductRow, qty: number): CartLine => ({
  productId: p.id,
  code: p.code,
  name: p.name,
  unitPrice: p.price,
  isvRate: p.isvRate,
  qty,
});

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.categories.bulkPut(
    CATEGORIAS.map(([code, name], i) => ({ code, name, sortOrder: i + 1 })),
  );
  await db.products.bulkPut([PZ001, BE008]);
  await db.shifts.put(turno);
  fetchSpy = vi.spyOn(globalThis, "fetch");
  window.print = vi.fn();
});

afterEach(() => {
  fetchSpy.mockRestore();
});

async function armarPedido(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("tab", { name: "Pollo en piezas" }));
  const pz = await screen.findByRole("button", { name: /4 piezas de pollo/ });
  await user.click(pz);
  await user.click(pz);
  await user.click(screen.getByRole("tab", { name: "Bebidas" }));
  await user.click(await screen.findByRole("button", { name: /12 oz Pepsi/ }));
}

describe("carrito (lógica pura)", () => {
  it("calcula total e ISV por línea como el servidor", () => {
    expect(cartTotals([linea(PZ001, 2), linea(BE008, 1)])).toEqual({
      total: 253,
      base: 220,
      isv: 33,
    });
  });

  it("valida transferencia con referencia y suma de pagos", () => {
    const efectivo: PaymentInput = { method: "efectivo", amount: 200, cashReceived: 200 };
    const transf = (ref: string): PaymentInput => ({
      method: "transferencia",
      amount: 53,
      transferReference: ref,
    });
    expect(validatePayments(253, [efectivo, transf("")])).not.toBeNull();
    expect(validatePayments(253, [efectivo, transf("AB1")])).not.toBeNull();
    expect(validatePayments(253, [efectivo, transf("AB12")])).toBeNull();
    expect(
      validatePayments(253, [{ method: "efectivo", amount: 253, cashReceived: 250 }]),
    ).not.toBeNull();
  });

  it("el teclado limita a 2 decimales y un solo punto", () => {
    let v = "";
    for (const k of ["1", ".", "5", ".", "0", "7"]) v = applyKey(v, k);
    expect(v).toBe("1.50");
    expect(applyKey(v, "borrar")).toBe("1.5");
  });
});

describe("pantalla de venta", () => {
  it("muestra las 6 pestañas en orden y botones táctiles de 72 px", async () => {
    render(<SaleScreen cashier={cajero} shift={turno} />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(CATEGORIAS.map(([, n]) => n));
    expect(tabs[0]?.className).toContain("bg-accent");
    await userEvent.setup().click(screen.getByRole("tab", { name: "Pollo en piezas" }));
    const boton = await screen.findByRole("button", { name: /4 piezas de pollo/ });
    expect(boton.textContent).toContain("L 120.00");
    expect(boton.className).toContain("min-h-18");
    expect(boton.className).toContain("min-w-18");
  });

  it("totaliza, exige tipo de pedido y cobra en efectivo con cambio", async () => {
    const user = userEvent.setup();
    render(<SaleScreen cashier={cajero} shift={turno} />);
    await armarPedido(user);
    expect(screen.getByLabelText("Total").textContent).toBe("L 253.00");
    expect(screen.getByLabelText("ISV incluido").textContent).toBe("L 33.00");

    const cobrar = screen.getByRole("button", { name: "Cobrar" }) as HTMLButtonElement;
    expect(cobrar.disabled).toBe(true);
    await user.click(screen.getByRole("radio", { name: "Para llevar" }));
    expect(cobrar.disabled).toBe(false);
    await user.click(cobrar);

    const dialogo = await screen.findByRole("dialog");
    const confirmar = within(dialogo).getByRole("button", {
      name: "Confirmar",
    }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    for (const k of ["3", "0", "0"]) {
      await user.click(within(dialogo).getByRole("button", { name: k }));
    }
    expect(within(dialogo).getByLabelText("Cambio").textContent).toBe("L 47.00");
    expect(confirmar.disabled).toBe(false);
    await user.click(confirmar);

    expect((await screen.findByRole("status")).textContent).toBe("Recibo R-00000001 registrado");
    const ventas = await db.sales.toArray();
    expect(ventas).toHaveLength(1);
    expect(ventas[0]?.receiptCode).toBe("R-00000001");
    expect(ventas[0]?.orderType).toBe("para_llevar");
    expect(ventas[0]?.payments[0]).toMatchObject({ amount: 253, cashReceived: 300, change: 47 });
    const eventos = await db.outbox.toArray();
    expect(eventos.map((e) => e.type)).toEqual(["venta"]);
    expect(eventos[0]?.payload).toMatchObject({
      receipt_number: 1,
      total: 253,
      order_type: "para_llevar",
      lines: [
        { product_id: "p-pz001", qty: 2, unit_price: 120 },
        { product_id: "p-be008", qty: 1, unit_price: 13 },
      ],
    });
    expect(screen.getByLabelText("Total").textContent).toBe("L 0.00");
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("en pago mixto exige referencia de 4+ caracteres", async () => {
    const user = userEvent.setup();
    render(<SaleScreen cashier={cajero} shift={turno} />);
    await armarPedido(user);
    await user.click(screen.getByRole("radio", { name: "Comer aquí" }));
    await user.click(screen.getByRole("button", { name: "Cobrar" }));
    const dialogo = await screen.findByRole("dialog");
    await user.click(within(dialogo).getByRole("radio", { name: "Mixto" }));
    for (const k of ["2", "0", "0"]) {
      await user.click(within(dialogo).getByRole("button", { name: k }));
    }
    expect(dialogo.textContent).toContain("Transferencia: L 53.00");
    const confirmar = within(dialogo).getByRole("button", {
      name: "Confirmar",
    }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    const ref = within(dialogo).getByLabelText("Referencia de transferencia");
    await user.type(ref, "AB1");
    expect(confirmar.disabled).toBe(true);
    await user.type(ref, "2");
    expect(confirmar.disabled).toBe(false);
    expect(await db.sales.count()).toBe(0);
  });
});

describe("registerSale concurrente", () => {
  it("asigna recibos correlativos sin huecos y encola eventos consecutivos sin red", async () => {
    const venta = () =>
      registerSale({
        cart: [linea(PZ001, 1)],
        orderType: "comer_aqui",
        payments: [{ method: "efectivo", amount: 120, cashReceived: 120 }],
        cashier: cajero,
        shift: turno,
      });
    const [a, b] = await Promise.all([venta(), venta()]);
    expect([a.receiptCode, b.receiptCode].sort()).toEqual(["R-00000001", "R-00000002"]);
    const eventos = await db.outbox.orderBy("clientSeq").toArray();
    expect(eventos.map((e) => e.type)).toEqual(["venta", "venta"]);
    expect(eventos.map((e) => e.clientSeq - (eventos[0]?.clientSeq ?? 0))).toEqual([0, 1]);
    expect(eventos.map((e) => e.payload.receipt_number)).toEqual([1, 2]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
