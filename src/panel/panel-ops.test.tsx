import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient, resetBackendForTests, type Backend } from "@/lib/backend";
import { PanelRoutes } from "@/panel/PanelRoutes";

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

const LISTAS: Record<string, unknown[]> = {
  stock: [
    { code: "POLLO-ENTERO", name: "Pollo entero", kind: "pollo_entero", qty: 10, min_stock: 4 },
    { code: "PAPA-PERS", name: "Papas porción personal", kind: "insumo", qty: 2, min_stock: 5 },
    { code: "ALA", name: "Ala", kind: "pieza", qty: 0, min_stock: 0 },
  ],
  productos: [
    {
      code: "PZ-001",
      name: "4 piezas de pollo",
      category_code: "PZ",
      price: 120,
      isv_rate: 0.15,
      active: true,
    },
  ],
  recetas: [],
  staff: [
    {
      id: "st-1",
      display_name: "Luis",
      role: "supervisor",
      active: true,
      has_pin: true,
      has_panel: true,
    },
  ],
  dispositivos: [{ id: "d1", label: "Caja 1", active: true, last_seen_at: null }],
};

function backendConRol(role: "socio" | "supervisor") {
  fake.getSession.mockResolvedValue({ userId: "u1", aal: "aal2", isAnonymous: false });
  fake.rpc.mockImplementation((fn: string, args?: { p_kind?: string }) => {
    if (fn === "panel_whoami")
      return Promise.resolve({ staff_id: "st-1", display_name: "Luis", role });
    if (fn === "panel_list") return Promise.resolve(LISTAS[args?.p_kind ?? ""] ?? []);
    if (fn === "create_pairing_code")
      return Promise.resolve({ code: "K7M2Q9XA", expires_at: "2026-11-22T16:15:00Z" });
    return Promise.resolve(null);
  });
}

function renderEn(ruta: string) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/panel/*" element={<PanelRoutes />} />
      </Routes>
    </MemoryRouter>,
  );
}

const llamadas = (fn: string) => fake.rpc.mock.calls.filter((c) => c[0] === fn);

beforeEach(() => {
  resetBackendForTests();
  queryClient.clear();
  for (const f of Object.values(fake)) f.mockReset();
});

describe("inventario", () => {
  it("compra de pollo entero sin libras se rechaza sin llamar la RPC", async () => {
    backendConRol("supervisor");
    const user = userEvent.setup();
    renderEn("/panel/inventario");
    const compra = await screen.findByLabelText("Registrar compra");
    await within(compra).findByRole("option", { name: /POLLO-ENTERO/ });
    await user.selectOptions(within(compra).getByLabelText("Ítem"), "POLLO-ENTERO");
    await user.type(within(compra).getByLabelText("Cantidad"), "20");
    await user.type(within(compra).getByLabelText("Costo total"), "2500");
    await user.type(within(compra).getByLabelText("Proveedor"), "Avícola del Valle");
    await user.click(within(compra).getByRole("button", { name: "Guardar compra" }));
    expect((await within(compra).findByRole("alert")).textContent).toBe(
      "Las libras son obligatorias para pollo entero",
    );
    expect(llamadas("register_purchase")).toHaveLength(0);

    await user.type(within(compra).getByLabelText("Libras"), "95.5");
    await user.click(within(compra).getByRole("button", { name: "Guardar compra" }));
    await waitFor(() => expect(llamadas("register_purchase")).toHaveLength(1));
    expect(llamadas("register_purchase")[0]?.[1]).toEqual({
      p_item_code: "POLLO-ENTERO",
      p_qty: 20,
      p_total_cost: 2500,
      p_supplier: "Avícola del Valle",
      p_pounds: 95.5,
      p_photo_path: null,
    });
    expect(await within(compra).findByText("Compra registrada")).toBeTruthy();
  });

  it("resalta el stock bajo mínimo", async () => {
    backendConRol("supervisor");
    renderEn("/panel/inventario");
    expect(await screen.findByText(/Papas porción personal \(bajo mínimo\)/)).toBeTruthy();
    expect(screen.queryByText(/Pollo entero \(bajo mínimo\)/)).toBeNull();
    expect(screen.queryByText(/^Ala \(bajo mínimo\)/)).toBeNull();
  });

  it("corte de 3 pollos propone 6/6/6/6 editables y envía el desglose final", async () => {
    backendConRol("supervisor");
    const user = userEvent.setup();
    renderEn("/panel/inventario");
    const corte = await screen.findByLabelText("Corte");
    await user.type(within(corte).getByLabelText("Pollos a cortar"), "3");
    for (const n of ["Alas", "Piernas", "Muslos", "Pechugas"]) {
      expect((within(corte).getByLabelText(n) as HTMLInputElement).value).toBe("6");
    }
    const alas = within(corte).getByLabelText("Alas");
    await user.clear(alas);
    await user.type(alas, "5");
    await user.click(within(corte).getByRole("button", { name: "Registrar corte" }));
    await waitFor(() => expect(llamadas("register_cut")).toHaveLength(1));
    expect(llamadas("register_cut")[0]?.[1]).toEqual({
      p_chickens: 3,
      p_pieces: { ALA: 5, PIERNA: 6, MUSLO: 6, PECHUGA: 6 },
    });
  });

  it("receta sin líneas se rechaza y solo envía líneas con cantidad > 0", async () => {
    backendConRol("supervisor");
    const user = userEvent.setup();
    renderEn("/panel/inventario");
    const recetas = await screen.findByLabelText("Recetas");
    await within(recetas).findByRole("option", { name: /PZ-001/ });
    await user.selectOptions(within(recetas).getByLabelText("Producto"), "PZ-001");
    await user.click(within(recetas).getByRole("button", { name: "Guardar receta" }));
    expect((await within(recetas).findByRole("alert")).textContent).toBe(
      "La receta necesita al menos una línea",
    );
    expect(llamadas("upsert_recipe")).toHaveLength(0);

    await user.click(within(recetas).getByRole("button", { name: "Agregar línea" }));
    await user.click(within(recetas).getByRole("button", { name: "Agregar línea" }));
    await user.selectOptions(within(recetas).getByLabelText("Ítem 1"), "ALA");
    await user.type(within(recetas).getByLabelText("Cantidad 1"), "4");
    await user.selectOptions(within(recetas).getByLabelText("Ítem 2"), "PAPA-PERS");
    await user.type(within(recetas).getByLabelText("Cantidad 2"), "0");
    await user.click(within(recetas).getByRole("button", { name: "Guardar receta" }));
    await waitFor(() => expect(llamadas("upsert_recipe")).toHaveLength(1));
    expect(llamadas("upsert_recipe")[0]?.[1]).toEqual({
      p_product_code: "PZ-001",
      p_lines: [{ item_code: "ALA", qty: 4 }],
    });
  });

  it("el socio ve el stock sin formularios ni enlace de administración", async () => {
    backendConRol("socio");
    renderEn("/panel/inventario");
    expect(await screen.findByText("Pollo entero")).toBeTruthy();
    expect(screen.queryByLabelText("Registrar compra")).toBeNull();
    expect(screen.queryByLabelText("Corte")).toBeNull();
    expect(screen.queryByRole("link", { name: "Administración" })).toBeNull();
  });
});

describe("administración", () => {
  it("crea un cajero enviando sal y hash, nunca el PIN", async () => {
    backendConRol("supervisor");
    const user = userEvent.setup();
    renderEn("/panel/administracion");
    const personal = await screen.findByLabelText("Personal");
    await user.type(within(personal).getByLabelText("Nombre"), "Marta");
    await user.type(within(personal).getByLabelText(/PIN de 4 dígitos/), "4821");
    await user.click(within(personal).getByRole("button", { name: "Crear persona" }));

    await waitFor(() => expect(llamadas("upsert_staff")).toHaveLength(1), { timeout: 5000 });
    const args = llamadas("upsert_staff")[0]?.[1] as Record<string, unknown>;
    expect(args).toMatchObject({
      p_id: null,
      p_display_name: "Marta",
      p_role: "cajero",
      p_active: true,
      p_pin_iterations: 210000,
    });
    expect(args.p_pin_salt).toMatch(/^[0-9a-f]{32}$/);
    expect(args.p_pin_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain("4821");
  });

  it("genera un código de emparejamiento que vence en 15 minutos", async () => {
    backendConRol("supervisor");
    const user = userEvent.setup();
    renderEn("/panel/administracion");
    const cajas = await screen.findByLabelText("Cajas");
    await user.type(within(cajas).getByLabelText("Nombre de la caja"), "Caja 2");
    await user.click(
      within(cajas).getByRole("button", { name: "Generar código de emparejamiento" }),
    );
    const aviso = await within(cajas).findByRole("status");
    expect(aviso.textContent).toContain("K7M2Q9XA");
    expect(aviso.textContent).toContain("vence en 15 minutos");
    expect(llamadas("create_pairing_code")[0]?.[1]).toEqual({ p_label: "Caja 2" });
  });

  it("verifica la bitácora", async () => {
    backendConRol("supervisor");
    const base = fake.rpc.getMockImplementation();
    fake.rpc.mockImplementation((fn: string, args?: unknown) =>
      fn === "verify_audit_chain"
        ? Promise.resolve({ ok: true, first_bad_id: null, checked: 1520 })
        : base?.(fn, args),
    );
    const user = userEvent.setup();
    renderEn("/panel/administracion");
    const bitacora = await screen.findByLabelText("Bitácora");
    await user.click(within(bitacora).getByRole("button", { name: "Verificar bitácora" }));
    expect((await within(bitacora).findByRole("status")).textContent).toBe(
      "Bitácora íntegra: 1520 registros",
    );
  });
});
