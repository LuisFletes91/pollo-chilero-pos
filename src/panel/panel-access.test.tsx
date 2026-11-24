import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackendError,
  queryClient,
  resetBackendForTests,
  type Backend,
  type Session,
} from "@/lib/backend";
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

const sesion = (aal: Session["aal"]): Session => ({ userId: "u1", aal, isAnonymous: false });

const SUMMARY = {
  venta_total: 1234.5,
  recibos: 7,
  ticket_promedio: 176.36,
  por_hora: [{ hora: 11, monto: 600 }],
  por_categoria: [{ categoria: "Combos familiares", monto: 627 }],
  por_forma_pago: { efectivo: 1000, transferencia: 234.5 },
  diferencias_caja: [],
  merma_piezas: [],
  anulaciones: { cantidad: 0, monto: 0 },
  reimpresiones: 1,
  aperturas_sin_venta: 0,
  cajas: [{ id: "d1", label: "Caja 1", last_seen_at: null, active: true }],
};
const LISTAS: Record<string, unknown[]> = {
  alertas: [
    { id: 41, kind: "reimpresion", severity: "baja", message: "Reimpresión de R-00000003" },
  ],
  transferencias_pendientes: [
    { payment_id: "pay-1", receipt_code: "R-00000005", amount: 253, reference: "BAC-1234" },
  ],
  anulaciones_pendientes: [
    {
      void_id: "void-1",
      receipt_code: "R-00000004",
      total: 120,
      reason: "Cliente se fue",
      requested_by: "Ana",
    },
  ],
};

function backendConRol(role: "socio" | "supervisor") {
  fake.getSession.mockResolvedValue(sesion("aal2"));
  fake.rpc.mockImplementation((fn: string, args?: { p_kind?: string }) => {
    if (fn === "panel_whoami")
      return Promise.resolve({ staff_id: "st-1", display_name: "Luis", role });
    if (fn === "panel_summary") return Promise.resolve(SUMMARY);
    if (fn === "panel_list") return Promise.resolve(LISTAS[args?.p_kind ?? ""] ?? []);
    return Promise.resolve(null);
  });
}

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={["/panel"]}>
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

afterEach(() => {
  vi.useRealTimers();
});

describe("acceso al panel", () => {
  it("sin sesión muestra Iniciar sesión y ningún dato del negocio", async () => {
    fake.getSession.mockResolvedValue(null);
    renderPanel();
    expect(screen.getByRole("heading", { level: 1, name: "Panel de socios" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeTruthy();
    expect(screen.getByLabelText("Correo").getAttribute("autocomplete")).toBe("username");
    expect(screen.getByLabelText("Contraseña").getAttribute("autocomplete")).toBe(
      "current-password",
    );
    expect(document.body.textContent).not.toMatch(/L \d/);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("credenciales incorrectas muestran el error genérico", async () => {
    fake.getSession.mockResolvedValue(null);
    fake.signInWithPassword.mockRejectedValue(new BackendError("AUTH", "Invalid login"));
    const user = userEvent.setup();
    renderPanel();
    await user.type(await screen.findByLabelText("Correo"), "luis@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "mala");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Correo o contraseña incorrectos");
  });

  it("aal1 sin factor muestra el QR y exige 6 dígitos antes del tablero", async () => {
    fake.getSession.mockResolvedValue(sesion("aal1"));
    fake.listTotpFactors.mockResolvedValue([]);
    fake.enrollTotp.mockResolvedValue({
      factorId: "f1",
      qrCodeSvg: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
      secret: "JBSWY3DPEHPK3PXP",
    });
    fake.verifyTotp.mockResolvedValue(sesion("aal2"));
    fake.rpc.mockImplementation((fn: string) =>
      fn === "panel_whoami"
        ? Promise.resolve({ staff_id: "st-1", display_name: "Luis", role: "socio" })
        : Promise.resolve(fn === "panel_summary" ? SUMMARY : []),
    );
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByAltText(/Código QR/)).toBeTruthy();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    const campo = screen.getByLabelText("Código de 6 dígitos");
    expect(campo.getAttribute("autocomplete")).toBe("one-time-code");
    const verificar = screen.getByRole("button", { name: "Verificar" }) as HTMLButtonElement;
    await user.type(campo, "12345");
    expect(verificar.disabled).toBe(true);
    expect(fake.rpc).not.toHaveBeenCalled();
    await user.type(campo, "6");
    expect(verificar.disabled).toBe(false);
    await user.click(verificar);

    expect(fake.verifyTotp).toHaveBeenCalledWith("f1", "123456");
    expect(await screen.findByLabelText("Venta total")).toBeTruthy();
  });

  it("aal1 con factor verificado solo pide el código", async () => {
    fake.getSession.mockResolvedValue(sesion("aal1"));
    fake.listTotpFactors.mockResolvedValue([{ id: "f9", status: "verified" }]);
    renderPanel();
    expect(await screen.findByLabelText("Código de 6 dígitos")).toBeTruthy();
    expect(screen.queryByAltText(/Código QR/)).toBeNull();
    expect(fake.enrollTotp).not.toHaveBeenCalled();
  });

  it("un usuario sin rol de panel ve el aviso y puede cerrar sesión", async () => {
    fake.getSession.mockResolvedValue(sesion("aal2"));
    fake.rpc.mockRejectedValue(new BackendError("NO_AUTORIZADO", "usuario sin acceso al panel"));
    renderPanel();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Su usuario no tiene acceso al panel",
    );
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeTruthy();
  });
});

describe("tablero", () => {
  it("socio ve las tarjetas y alertas sin botones de decisión", async () => {
    backendConRol("socio");
    renderPanel();
    const venta = await screen.findByLabelText("Venta total");
    expect(venta.textContent).toContain("L 1,234.50");
    expect(screen.getByLabelText("Recibos").textContent).toContain("7");
    expect(screen.getByLabelText("Ticket promedio").textContent).toContain("L 176.36");
    expect(await screen.findByText(/Reimpresión de R-00000003/)).toBeTruthy();
    expect(await screen.findByText(/R-00000005/)).toBeTruthy();
    for (const nombre of ["Confirmar", "Rechazar", "Aprobar", "Reconocer"]) {
      expect(screen.queryByRole("button", { name: nombre })).toBeNull();
    }
  });

  it("supervisor decide transferencias, anulaciones y alertas con sus RPC", async () => {
    backendConRol("supervisor");
    const user = userEvent.setup();
    renderPanel();

    const transf = await screen.findByLabelText("Transferencias por confirmar");
    await user.click(await within(transf).findByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(fake.rpc).toHaveBeenCalledWith("confirm_transfer", { p_payment_id: "pay-1" }),
    );
    const rechazar = within(transf).getByRole("button", { name: "Rechazar" }) as HTMLButtonElement;
    expect(rechazar.disabled).toBe(true);
    await user.type(within(transf).getByLabelText(/Motivo de rechazo/), "No aparece en el banco");
    await user.click(rechazar);
    await waitFor(() =>
      expect(fake.rpc).toHaveBeenCalledWith("reject_transfer", {
        p_payment_id: "pay-1",
        p_reason: "No aparece en el banco",
      }),
    );

    const anul = screen.getByLabelText("Anulaciones por decidir");
    await user.click(await within(anul).findByRole("button", { name: "Aprobar" }));
    await waitFor(() =>
      expect(fake.rpc).toHaveBeenCalledWith("decide_void", {
        p_void_id: "void-1",
        p_approve: true,
      }),
    );

    const alertas = screen.getByLabelText("Alertas abiertas");
    await user.click(await within(alertas).findByRole("button", { name: "Reconocer" }));
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledWith("ack_alert", { p_alert_id: 41 }));
  });

  it("vuelve a consultar panel_summary a los 60 segundos", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    backendConRol("socio");
    renderPanel();
    await vi.waitFor(() => expect(llamadas("panel_summary")).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(llamadas("panel_summary")).toHaveLength(2));
  });
});
