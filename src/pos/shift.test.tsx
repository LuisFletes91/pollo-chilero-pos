import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPin, newSalt } from "@/lib/pin";
import { db, type SaleRow, type StaffRow } from "@/pos/db";
import {
  closeShift,
  currentShift,
  internalConsumption,
  openDrawer,
  openShift,
  requestVoid,
} from "@/pos/shift";
import { CloseShiftScreen, OpenShiftScreen } from "@/pos/ShiftScreens";

const ITER = 100000;
let cajero: StaffRow;
let sup: StaffRow;
let sup2: StaffRow;

async function staff(id: string, name: string, role: StaffRow["role"], pin: string) {
  const salt = newSalt();
  const row: StaffRow = {
    id,
    displayName: name,
    role,
    pinSalt: salt,
    pinHash: await hashPin(pin, salt, ITER),
    pinIterations: ITER,
  };
  await db.staff.put(row);
  return row;
}

async function venta(shiftId: string, n: number, efectivo: number): Promise<SaleRow> {
  const s: SaleRow = {
    id: crypto.randomUUID(),
    receiptNumber: n,
    receiptCode: `R-${String(n).padStart(8, "0")}`,
    shiftId,
    cashierId: cajero.id,
    orderType: "comer_aqui",
    lines: [],
    payments: [
      {
        paymentId: crypto.randomUUID(),
        method: "efectivo",
        amount: efectivo,
        cashReceived: efectivo,
      },
    ],
    total: efectivo,
    isv: 0,
    createdAt: new Date().toISOString(),
    status: "registrada",
  };
  await db.sales.put(s);
  return s;
}

const eventos = () => db.outbox.orderBy("clientSeq").toArray();

beforeEach(async () => {
  await db.delete();
  await db.open();
  cajero = await staff("c1", "Ana", "cajero", "1111");
  sup = await staff("s1", "Sofía", "supervisor", "2222");
  sup2 = await staff("s2", "Saúl", "supervisor", "3333");
});

describe("apertura de turno", () => {
  it("guarda el fondo y encola turno_abierto con aprobador", async () => {
    const t = await openShift(cajero, sup, { "100": 3, "50": 4 });
    expect(t.openingTotal).toBe(500);
    expect((await currentShift())?.id).toBe(t.id);
    const [ev] = await eventos();
    expect(ev?.type).toBe("turno_abierto");
    expect(ev?.payload).toMatchObject({ shift_id: t.id, approved_by: "s1" });
  });

  it("rechaza que el cajero se apruebe a sí mismo desde la pantalla", async () => {
    render(<OpenShiftScreen cashier={sup} />);
    await screen.findByRole("option", { name: "Sofía" });
    await userEvent.selectOptions(screen.getByLabelText("Supervisor"), "s1");
    await userEvent.type(screen.getByLabelText("PIN del supervisor"), "2222");
    await screen.findByText("PIN verificado");
    await userEvent.click(screen.getByRole("button", { name: "Abrir turno" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Se requiere otro supervisor");
    expect(await db.outbox.count()).toBe(0);
  });
});

describe("cierre ciego", () => {
  it("no muestra el esperado hasta enviar el conteo", async () => {
    const t = await openShift(cajero, sup, { "100": 3, "50": 4 });
    await venta(t.id, 1, 120);
    render(<CloseShiftScreen shiftId={t.id} onDone={() => {}} />);
    await screen.findByRole("button", { name: "Agregar L 500.00" });
    expect(screen.queryByText(/Esperado/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Agregar L 500.00" }));
    await userEvent.click(screen.getByRole("button", { name: "Agregar L 100.00" }));
    await userEvent.click(screen.getByRole("button", { name: "Enviar conteo" }));
    await screen.findByText("Esperado: L 620.00");
    expect(screen.getByText("Contado: L 600.00")).toBeTruthy();
    expect(screen.getByText("Diferencia: -L 20.00")).toBeTruthy();
    const evs = await eventos();
    expect(evs.at(-1)?.type).toBe("turno_cerrado");
  });

  it("closeShift calcula la diferencia sin contar ventas anuladas", async () => {
    const t = await openShift(cajero, sup, { "100": 5 });
    const v = await venta(t.id, 1, 100);
    await requestVoid(cajero, v, "Pedido equivocado", sup);
    const r = await closeShift(t.id, { "500": 1 });
    expect(r).toEqual({ esperado: 500, contado: 500, diferencia: 0 });
  });
});

describe("acciones de supervisor", () => {
  it("anula con o sin aprobador", async () => {
    const t = await openShift(cajero, sup, { "100": 1 });
    const a = await venta(t.id, 1, 50);
    const b = await venta(t.id, 2, 60);
    await requestVoid(cajero, a, "Cliente se arrepintió");
    await requestVoid(cajero, b, "Cobro duplicado", sup2);
    expect((await db.sales.get(a.id))?.status).toBe("anulacion_solicitada");
    expect((await db.sales.get(b.id))?.status).toBe("anulada");
    const voids = (await eventos()).filter((e) => e.type === "anulacion_solicitada");
    expect(voids[0]?.payload).not.toHaveProperty("approved_by");
    expect(voids[1]?.payload).toMatchObject({ approved_by: "s2" });
  });

  it("exige motivo para la gaveta y aprobador para consumo interno", async () => {
    const t = await openShift(cajero, sup, { "100": 1 });
    const antes = await db.outbox.count();
    await expect(openDrawer(cajero, t.id, "  ")).rejects.toThrow(/motivo/);
    expect(await db.outbox.count()).toBe(antes);
    await openDrawer(cajero, t.id, "Cambio de billete");
    await expect(internalConsumption(sup, "ALA", 1, "Almuerzo", sup)).rejects.toThrow(
      "Se requiere otro supervisor",
    );
    await internalConsumption(cajero, "ALA", 1, "Almuerzo del personal", sup);
    const tipos = (await eventos()).map((e) => e.type);
    expect(tipos.slice(-2)).toEqual(["gaveta_abierta", "consumo_interno"]);
  });
});
