import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackendError, queryClient, resetBackendForTests, type Backend } from "@/lib/backend";
import { db, getMeta, setMeta } from "@/pos/db";
import { pairDevice, pullSnapshot } from "@/pos/device";
import { PosRoutes } from "@/pos/PosRoutes";

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

const snapshot = (version: number, lastReceipt: number) => ({
  version,
  unchanged: false,
  device: { id: "d1", label: "Caja 1", last_receipt_number: lastReceipt, last_client_seq: 3 },
  categories: [{ code: "PZ", name: "Pollo en piezas", sort_order: 3 }],
  products: [
    {
      id: "p1",
      code: "PZ-001",
      name: "4 piezas de pollo",
      category_code: "PZ",
      price: "120.00",
      isv_rate: "0.15",
      active: true,
      sort_order: 1,
    },
  ],
  staff: [
    {
      id: "s1",
      display_name: "Ana",
      role: "cajero",
      pin_salt: "0".repeat(32),
      pin_hash: "a".repeat(64),
      pin_iterations: 210000,
    },
  ],
  settings: { cash_diff_threshold: 50 },
});

beforeEach(async () => {
  resetBackendForTests();
  queryClient.clear();
  for (const f of Object.values(fake)) f.mockReset();
  fake.signInAnonymously.mockResolvedValue({ userId: "u1", aal: "aal1", isAnonymous: true });
  await db.delete();
  await db.open();
});

describe("emparejamiento", () => {
  it("normaliza el código y guarda el dispositivo", async () => {
    fake.rpc.mockImplementation(async (fn: string) =>
      fn === "pos_claim_device" ? { device_id: "d1", label: "Caja 1" } : snapshot(1, 0),
    );
    await pairDevice(backend, "abcd2345", "Caja 1");
    expect(fake.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(fake.rpc).toHaveBeenNthCalledWith(1, "pos_claim_device", {
      p_code: "ABCD2345",
      p_label: "Caja 1",
    });
    expect(fake.signInAnonymously.mock.invocationCallOrder[0]).toBeLessThan(
      fake.rpc.mock.invocationCallOrder[0]!,
    );
    expect(await getMeta("deviceId")).toBe("d1");
  });

  it("muestra el error de código inválido y no guarda nada", async () => {
    fake.rpc.mockRejectedValue(new BackendError("CODIGO_INVALIDO", "CODIGO_INVALIDO: x"));
    render(createElement(MemoryRouter, null, createElement(PosRoutes)));
    const input = await screen.findByLabelText("Código de emparejamiento");
    expect(
      screen.getByRole("heading", { level: 1, name: "Caja — Emparejar esta caja" }),
    ).toBeTruthy();
    await userEvent.type(input, "abcd2345");
    await userEvent.click(screen.getByRole("button", { name: "Emparejar" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Código inválido o vencido"),
    );
    expect(await getMeta("deviceId")).toBeUndefined();
  });
});

describe("instantánea", () => {
  it("reemplaza las tablas y respeta el mayor número de recibo", async () => {
    await db.products.put({
      id: "viejo",
      code: "BE-001",
      name: "viejo",
      categoryCode: "BE",
      price: 1,
      isvRate: 0.15,
      active: true,
      sortOrder: 1,
    });
    fake.rpc.mockResolvedValue(snapshot(7, 120));
    await pullSnapshot(backend);
    expect(fake.rpc).toHaveBeenCalledWith("pos_pull_snapshot", { p_since: 0 });
    expect((await db.products.toArray()).map((p) => p.code)).toEqual(["PZ-001"]);
    expect((await db.products.get("p1"))?.price).toBe(120);
    expect(await db.staff.count()).toBe(1);
    expect(await db.categories.count()).toBe(1);
    expect((await db.settings.get("cash_diff_threshold"))?.value).toBe(50);
    expect(await getMeta("snapshotVersion")).toBe(7);
    expect(await getMeta("lastReceiptNumber")).toBe(120);

    await setMeta("lastReceiptNumber", 150);
    fake.rpc.mockResolvedValue(snapshot(8, 120));
    await pullSnapshot(backend);
    expect(await getMeta("lastReceiptNumber")).toBe(150);
  });

  it("no escribe si la instantánea no cambió", async () => {
    await setMeta("snapshotVersion", 7);
    await db.products.put({
      id: "local",
      code: "PZ-001",
      name: "local",
      categoryCode: "PZ",
      price: 120,
      isvRate: 0.15,
      active: true,
      sortOrder: 1,
    });
    fake.rpc.mockResolvedValue({ version: 7, unchanged: true, device: snapshot(7, 0).device });
    await pullSnapshot(backend);
    expect(fake.rpc).toHaveBeenCalledWith("pos_pull_snapshot", { p_since: 7 });
    expect((await db.products.toArray()).map((p) => p.id)).toEqual(["local"]);
  });
});
