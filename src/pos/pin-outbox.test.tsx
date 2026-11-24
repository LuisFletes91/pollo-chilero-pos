import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPin, newSalt } from "@/lib/pin";
import { CashierLogin } from "@/pos/CashierLogin";
import { db, type StaffRow } from "@/pos/db";
import { enqueueEvent } from "@/pos/outbox";

const ITER = 100000;

async function staff(id: string, name: string, pin: string): Promise<StaffRow> {
  const salt = newSalt();
  const row: StaffRow = {
    id,
    displayName: name,
    role: "cajero",
    pinSalt: salt,
    pinHash: await hashPin(pin, salt, ITER),
    pinIterations: ITER,
  };
  await db.staff.put(row);
  return row;
}

async function teclear(pin: string) {
  for (const d of pin) await userEvent.click(screen.getByRole("button", { name: d }));
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("hashPin", () => {
  it("es determinista y distingue PIN", async () => {
    const sal = newSalt();
    expect(sal).toMatch(/^[0-9a-f]{32}$/);
    const a = await hashPin("1234", sal, 210000);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashPin("1234", sal, 210000)).toBe(a);
    expect(await hashPin("1235", sal, 210000)).not.toBe(a);
  });
});

describe("CashierLogin", () => {
  it("muestra un botón por cajero y entra con el PIN correcto", async () => {
    await staff("s1", "Ana", "1234");
    await staff("s2", "Beto", "9999");
    const onLogin = vi.fn();
    render(<CashierLogin onLogin={onLogin} />);
    await screen.findByRole("button", { name: "Ana" });
    expect(screen.getByRole("button", { name: "Beto" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Caja — ¿Quién atiende?" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Ana" }));
    await teclear("1234");
    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
    expect(onLogin.mock.calls[0]![0].id).toBe("s1");
  });

  it("bloquea tras 5 PIN incorrectos y encola pin_bloqueado", async () => {
    await staff("s1", "Ana", "1234");
    const onLogin = vi.fn();
    render(<CashierLogin onLogin={onLogin} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ana" }));
    for (let i = 1; i <= 5; i++) {
      await teclear("0000");
      await waitFor(async () => {
        const row = await db.pinAttempts.get("s1");
        expect(i < 5 ? row?.failures : Boolean(row?.lockedUntil)).toBe(i < 5 ? i : true);
        expect((screen.getByRole("button", { name: "0" }) as HTMLButtonElement).disabled).toBe(
          false,
        );
      });
      expect(screen.getByRole("alert").textContent).toBe(
        i < 5 ? "PIN incorrecto" : "Bloqueado 30 s",
      );
    }
    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    const ev = (await db.outbox.toArray())[0]!;
    expect(ev.type).toBe("pin_bloqueado");
    expect(ev.payload).toEqual({ blocked_staff_id: "s1" });
    expect(onLogin).not.toHaveBeenCalled();
  }, 30000);
});

describe("outbox", () => {
  it("asigna client_seq consecutivos y event_id únicos", async () => {
    const a = await enqueueEvent("pin_bloqueado", "s1", { blocked_staff_id: "s1" });
    const b = await enqueueEvent("pin_bloqueado", "s1", { blocked_staff_id: "s1" });
    const c = await enqueueEvent("pin_bloqueado", "s1", { blocked_staff_id: "s1" });
    expect([a.clientSeq, b.clientSeq, c.clientSeq]).toEqual([1, 2, 3]);
    expect(new Set([a.eventId, b.eventId, c.eventId]).size).toBe(3);
    const rows = await db.outbox.orderBy("clientSeq").toArray();
    expect(rows.map((r) => r.clientSeq)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.status === "pendiente" && r.attempts === 0)).toBe(true);
  });
});
