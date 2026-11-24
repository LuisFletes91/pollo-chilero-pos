import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendError, queryClient, resetBackendForTests, type Backend } from "@/lib/backend";
import { toLocalHN } from "@/lib/utils";
import { db, getMeta, setMeta, type OutboxRow } from "@/pos/db";
import { buildEmergencyExport, emergencyFileName, exportEmergency } from "@/pos/emergency-export";
import { enqueueEvent } from "@/pos/outbox";
import { resetSyncForTests, retryDelaySeconds, syncOnce, type SyncState } from "@/pos/sync";
import { SyncIndicator } from "@/pos/SyncIndicator";

type Lote = { p_events: { client_seq: number; type: string }[] };

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
const backend = fake as unknown as Backend;

vi.mock("@/lib/backend-impl", () => ({ createBackendImpl: () => fake }));

/** Responde a cada evento del lote con el estado indicado. */
const responder =
  (estado: "aplicado" | "duplicado" | "rechazado", error?: string) => (_fn: string, args: Lote) =>
    Promise.resolve({
      resultados: args.p_events.map((e) => ({
        client_seq: e.client_seq,
        estado,
        ...(error ? { error } : {}),
      })),
      recibido_en: new Date().toISOString(),
    });

async function encolar(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await enqueueEvent("gaveta_abierta", "c1", {
      opening_id: crypto.randomUUID(),
      shift_id: "t1",
      reason: "Cambio de billete",
    });
  }
}

const estado = () => getMeta<SyncState>("syncState");
const filas = (): Promise<OutboxRow[]> => db.outbox.orderBy("clientSeq").toArray();
const seqsEnviados = () =>
  fake.rpc.mock.calls.map((c) => (c[1] as Lote).p_events.map((e) => e.client_seq));

beforeEach(async () => {
  resetBackendForTests();
  queryClient.clear();
  resetSyncForTests();
  for (const f of Object.values(fake)) f.mockReset();
  await db.delete();
  await db.open();
});

afterEach(() => {
  resetSyncForTests();
  vi.useRealTimers();
});

describe("syncOnce", () => {
  it("envía 50 pendientes en 2 lotes de 25 en orden de clientSeq", async () => {
    await encolar(50);
    fake.rpc.mockImplementation(responder("aplicado"));
    const s = await syncOnce(backend);

    expect(fake.rpc).toHaveBeenCalledTimes(2);
    expect(fake.rpc.mock.calls[0]?.[0]).toBe("pos_push_events");
    const enviados = seqsEnviados();
    expect(enviados.map((l) => l.length)).toEqual([25, 25]);
    expect(enviados.flat()).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(s.estado).toBe("sincronizado");
    expect(s.pendientes).toBe(0);
    expect((await filas()).every((f) => f.status === "aplicado" && f.ackedAt)).toBe(true);
  });

  it("acepta duplicado como confirmado sin crear filas nuevas", async () => {
    await encolar(3);
    fake.rpc.mockImplementation(responder("duplicado"));
    const s = await syncOnce(backend);
    const r = await filas();
    expect(r).toHaveLength(3);
    expect(r.map((f) => f.status)).toEqual(["duplicado", "duplicado", "duplicado"]);
    expect(s.pendientes).toBe(0);
    expect(s.estado).toBe("sincronizado");
  });

  it("sin red conserva pendientes y reintenta a 2, 4, 8 s con tope de 300 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    await encolar(2);
    fake.rpc.mockRejectedValue(new BackendError("RED", "Sin conexión"));

    const s = await syncOnce(backend);
    expect(s.estado).toBe("sin_conexion");
    expect(s.pendientes).toBe(2);
    expect(s.reintentoEnSeg).toBe(2);
    expect((await filas()).map((f) => [f.status, f.attempts])).toEqual([
      ["pendiente", 1],
      ["pendiente", 1],
    ]);

    const esperarLlamadas = (n: number) =>
      vi.waitFor(() => expect(fake.rpc).toHaveBeenCalledTimes(n));

    await vi.advanceTimersByTimeAsync(1999);
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await esperarLlamadas(2);
    await vi.waitFor(async () => expect((await estado())?.reintentoEnSeg).toBe(4));

    await vi.advanceTimersByTimeAsync(3999);
    expect(fake.rpc).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await esperarLlamadas(3);
    await vi.waitFor(async () => expect((await estado())?.reintentoEnSeg).toBe(8));

    expect([1, 2, 3, 8, 9, 20].map(retryDelaySeconds)).toEqual([2, 4, 8, 256, 300, 300]);
    expect((await filas()).every((f) => f.status === "pendiente")).toBe(true);
  });

  it("un rechazo deja estado Error con el contador y el mensaje", async () => {
    await encolar(1);
    fake.rpc.mockImplementation(responder("rechazado", "TURNO_NO_ABIERTO: no hay turno"));
    const s = await syncOnce(backend);
    expect(s.estado).toBe("error");
    expect(s.rechazados).toBe(1);
    const [fila] = await filas();
    expect(fila?.status).toBe("rechazado");
    expect(fila?.lastError).toBe("TURNO_NO_ABIERTO: no hay turno");

    render(<SyncIndicator />);
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toContain("Error"));
    expect(status.textContent).toContain("1 rechazados");
  });

  it("dos llamadas simultáneas comparten un solo vuelo", async () => {
    await encolar(2);
    fake.rpc.mockImplementation(responder("aplicado"));
    await Promise.all([syncOnce(backend), syncOnce(backend)]);
    expect(seqsEnviados().flat()).toEqual([1, 2]);
  });
});

describe("indicador y respaldo", () => {
  it("muestra Sincronizado, 0 pendientes y la hora de la última sincronización", async () => {
    await encolar(1);
    fake.rpc.mockImplementation(responder("aplicado"));
    const s = await syncOnce(backend);
    expect(s.ultimaSincronizacion).toBeTruthy();

    render(<SyncIndicator />);
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toContain("Sincronizado"));
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("0 pendientes");
    expect(status.textContent).toContain(
      `Última sincronización ${toLocalHN(s.ultimaSincronizacion ?? "").hora}`,
    );
  });

  it("Reintentar ahora envía los pendientes y avisa si el almacenamiento no es persistente", async () => {
    await setMeta("storagePersisted", false);
    await encolar(1);
    fake.rpc.mockImplementation(responder("aplicado"));
    render(<SyncIndicator />);
    expect(
      await screen.findByText("El navegador puede borrar datos: no limpie el historial"),
    ).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar ahora" }));
    await waitFor(() => expect(fake.rpc).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect((await estado())?.pendientes).toBe(0));
  });

  it("exporta un JSON con outbox, sales, shifts y meta", async () => {
    await encolar(2);
    await db.shifts.put({
      id: "t1",
      cashierId: "c1",
      status: "abierto",
      openedAt: "2026-11-22T14:00:00.000Z",
      openingFloat: { "100": 5 },
      openingTotal: 500,
      approvedBy: "s1",
    });
    const data = await buildEmergencyExport();
    expect(Object.keys(data).sort()).toEqual(["exportado_en", "meta", "outbox", "sales", "shifts"]);
    expect(data.outbox).toHaveLength(2);
    expect(data.shifts).toHaveLength(1);
    expect(data.meta.lastClientSeq).toBe(2);

    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const blob = await exportEmergency();
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
    expect(blob.type).toBe("application/json");
    const json = JSON.parse(await blob.text()) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual(
      expect.arrayContaining(["outbox", "sales", "shifts", "meta"]),
    );
    expect(emergencyFileName(new Date("2026-11-23T03:00:00.000Z"))).toBe(
      "respaldo-caja-2026-11-22.json",
    );
  });
});
