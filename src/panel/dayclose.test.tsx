import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackendError, queryClient, resetBackendForTests, type Backend } from "@/lib/backend";
import { toCsv } from "@/lib/csv";
import { hashPin } from "@/lib/pin";
import { toLocalHN } from "@/lib/utils";
import { PanelRoutes } from "@/panel/PanelRoutes";
import type { ZReport } from "@/panel/ZReportView";

const fake = {
  rpc: vi.fn(),
  getSession: vi.fn(),
  signInAnonymously: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  listTotpFactors: vi.fn(),
  enrollTotp: vi.fn(),
  verifyTotp: vi.fn(),
  uploadReceiptPhoto: vi.fn(),
} satisfies Record<keyof Backend, unknown>;

vi.mock("@/lib/backend-impl", () => ({ createBackendImpl: () => fake }));

const HOY = toLocalHN(new Date()).fecha;
const SAL = "0".repeat(32);

const Z: ZReport = {
  fecha: HOY,
  recibos: { primero: "R-00000001", ultimo: "R-00000004", cantidad: 4 },
  ventas_total: 829,
  ventas_por_forma_pago: {
    efectivo: 576,
    transferencia_confirmada: 253,
    transferencia_rechazada: 0,
  },
  ventas_por_categoria: [{ categoria: "Pollo en piezas", unidades: 4, monto: 480 }],
  isv_incluido: { gravado_15: 720.87, isv_15: 108.13, gravado_18: 0, isv_18: 0, exento: 0 },
  anulaciones: { cantidad: 1, monto: 120 },
  reimpresiones: 0,
  aperturas_sin_venta: 0,
  consumo_interno: [],
  efectivo: {
    esperado: 1076,
    contado: 1000,
    diferencia: -76,
    justificacion: "Faltante revisado con la cajera",
    por_turno: [],
  },
  transferencias: {
    confirmadas: { cantidad: 1, monto: 253 },
    rechazadas: { cantidad: 0, monto: 0 },
  },
  merma: [{ item: "ALA", unidades: 2, valor: 30 }],
  ingreso: { tipo: "deposito_banco", monto: 1000, recibe: "Banco Atlántida" },
  firmado_por: "Luis",
  firmado_en: "2026-11-23T03:10:00.000Z",
};

let estado: { efectivo: boolean; inventario: boolean; ingreso: boolean };
let transferencias: unknown[];

function backendCierre() {
  estado = { efectivo: false, inventario: false, ingreso: false };
  transferencias = [
    {
      payment_id: "pay-1",
      receipt_code: "R-00000003",
      amount: 253,
      reference: "BAC-1234",
      business_date: HOY,
    },
  ];
  let finalizar = 0;
  fake.getSession.mockResolvedValue({ userId: "u1", aal: "aal2", isAnonymous: false });
  fake.rpc.mockImplementation((fn: string, args?: Record<string, unknown>) => {
    switch (fn) {
      case "panel_whoami":
        return Promise.resolve({ staff_id: "st-1", display_name: "Luis", role: "supervisor" });
      case "panel_list":
        if (args?.p_kind === "cierre")
          return Promise.resolve({
            business_date: HOY,
            status: "abierto",
            ...estado,
            z_report: null,
          });
        if (args?.p_kind === "stock")
          return Promise.resolve([
            { code: "ALA", name: "Ala", kind: "pieza" },
            { code: "BE-008", name: "Pepsi 12 oz", kind: "bebida" },
            { code: "PAPA-PERS", name: "Papas", kind: "insumo" },
          ]);
        if (args?.p_kind === "transferencias_pendientes") return Promise.resolve(transferencias);
        return Promise.resolve([]);
      case "day_close_cash_count":
        estado.efectivo = true;
        return Promise.resolve(null);
      case "day_close_inventory_count":
        estado.inventario = true;
        return Promise.resolve(null);
      case "confirm_transfer":
        transferencias = [];
        return Promise.resolve(null);
      case "day_close_deposit":
        estado.ingreso = true;
        return Promise.resolve(null);
      case "my_pin_params":
        return Promise.resolve({ pin_salt: SAL, pin_iterations: 1000 });
      case "day_close_finalize":
        finalizar += 1;
        return finalizar === 1
          ? Promise.reject(
              new BackendError("JUSTIFICACION_REQUERIDA", "diferencia de L -76 supera el umbral"),
            )
          : Promise.resolve(Z);
      default:
        return Promise.resolve(null);
    }
  });
}

const llamadas = (fn: string) => fake.rpc.mock.calls.filter((c) => c[0] === fn);

beforeEach(() => {
  resetBackendForTests();
  queryClient.clear();
  for (const f of Object.values(fake)) f.mockReset();
});

describe("cierre del día", () => {
  it("recorre los 5 pasos en orden, ciego, con justificación y termina en el Z", async () => {
    backendCierre();
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/panel/cierre"]}>
        <Routes>
          <Route path="/panel/*" element={<PanelRoutes />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "Iniciar cierre" }));
    expect(llamadas("day_close_start")[0]?.[1]).toEqual({ p_date: HOY });

    const pasos = await screen.findByRole("list", { name: "Pasos del cierre" });
    expect(
      within(pasos)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["1 Efectivo", "2 Inventario", "3 Transferencias", "4 Ingreso", "5 Firma"]);
    const siguiente = () => screen.getByRole("button", { name: "Siguiente" }) as HTMLButtonElement;

    // Paso 1: efectivo ciego.
    await waitFor(() => expect(llamadas("panel_list").length).toBeGreaterThan(0));
    expect(siguiente().disabled).toBe(true);
    expect(document.body.textContent?.toLowerCase()).not.toContain("esperado");
    expect(document.body.textContent).not.toContain("L 829.00");
    await user.type(screen.getByLabelText("L 500.00"), "2");
    expect(screen.getByText("Total contado: L 1,000.00")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Guardar conteo de efectivo" }));
    expect(llamadas("day_close_cash_count")[0]?.[1]).toEqual({
      p_date: HOY,
      p_counts: { "500": 2 },
    });
    await waitFor(() => expect(siguiente().disabled).toBe(false));
    await user.click(siguiente());

    // Paso 2: inventario ciego de piezas y bebidas (sin insumos ni teórico).
    expect(screen.getByRole("heading", { name: "Paso 2: Inventario" })).toBeTruthy();
    expect(siguiente().disabled).toBe(true);
    expect(screen.queryByLabelText("Papas")).toBeNull();
    await user.type(await screen.findByLabelText("Ala"), "10");
    await user.type(screen.getByLabelText("Pepsi 12 oz"), "24");
    await user.click(screen.getByRole("button", { name: "Guardar conteo de inventario" }));
    expect(llamadas("day_close_inventory_count")[0]?.[1]).toEqual({
      p_date: HOY,
      p_lines: [
        { item_code: "ALA", counted: 10 },
        { item_code: "BE-008", counted: 24 },
      ],
    });
    await waitFor(() => expect(siguiente().disabled).toBe(false));

    // Paso 3: transferencias; sigue solo cuando quedan 0.
    await waitFor(() => expect(siguiente().disabled).toBe(false));
    await user.click(siguiente());
    await waitFor(() => expect(siguiente().disabled).toBe(true));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(siguiente().disabled).toBe(false));
    await user.click(siguiente());

    // Paso 4: ingreso.
    expect(siguiente().disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText("Tipo de ingreso"), "deposito_banco");
    await user.type(screen.getByLabelText("Monto entregado"), "1000");
    await user.type(screen.getByLabelText("Quién recibe"), "Banco Atlántida");
    await user.click(screen.getByRole("button", { name: "Guardar ingreso" }));
    expect(llamadas("day_close_deposit")[0]?.[1]).toEqual({
      p_date: HOY,
      p_kind: "deposito_banco",
      p_amount: 1000,
      p_receiver: "Banco Atlántida",
      p_photo_path: null,
    });
    await waitFor(() => expect(siguiente().disabled).toBe(false));
    await user.click(siguiente());

    // Paso 5: firma con PIN (solo hash) y justificación.
    await user.type(screen.getByLabelText("PIN del supervisor"), "2222");
    await user.click(screen.getByRole("button", { name: "Firmar y cerrar el día" }));
    const just = await screen.findByLabelText("Justificación de la diferencia");
    const esperado = await hashPin("2222", SAL, 1000);
    expect(llamadas("day_close_finalize")[0]?.[1]).toEqual({ p_date: HOY, p_pin_hash: esperado });
    await user.type(just, "Faltante revisado con la cajera");
    await user.click(screen.getByRole("button", { name: "Firmar y cerrar el día" }));
    await waitFor(() => expect(llamadas("day_close_finalize")).toHaveLength(2));
    expect(llamadas("day_close_finalize")[1]?.[1]).toEqual({
      p_date: HOY,
      p_pin_hash: esperado,
      p_justification: "Faltante revisado con la cajera",
    });
    expect(JSON.stringify(fake.rpc.mock.calls)).not.toContain('"2222"');

    // Z final, solo lectura.
    const z = await screen.findByRole("article", { name: `Reporte Z ${HOY}` });
    for (const texto of [
      "R-00000001",
      "R-00000004",
      "L 576.00",
      "L 108.13",
      "L 1,076.00",
      "L 1,000.00",
      "-L 76.00",
      "ALA (2)",
    ]) {
      expect(z.textContent).toContain(texto);
    }
    expect(within(z).queryByRole("button", { name: /Editar/ })).toBeNull();
    expect(within(z).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(z).getByRole("button", { name: "Exportar Z (CSV)" })).toBeTruthy();
  });
});

describe("CSV", () => {
  it("empieza con BOM y escapa comillas según RFC 4180", () => {
    const csv = toCsv(
      [{ nombre: 'Pollo "chilero", 8 pzs' }],
      [{ key: "nombre", header: "Producto" }],
    );
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Pollo ""chilero"", 8 pzs"');
    expect(csv).toBe('﻿Producto\r\n"Pollo ""chilero"", 8 pzs"\r\n');
  });
});
