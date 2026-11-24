import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PosRoutes } from "@/pos/PosRoutes";
import { buildTestTicket } from "@/pos/print/escpos";
import { isWebSerialSupported } from "@/pos/print/serial";

function contiene(bytes: Uint8Array, seq: number[]): boolean {
  for (let i = 0; i <= bytes.length - seq.length; i++) {
    if (seq.every((b, j) => bytes[i + j] === b)) return true;
  }
  return false;
}

describe("ticket de prueba ESC/POS", () => {
  it("incluye ESC @ y GS V", () => {
    const bytes = buildTestTicket(new Date("2026-11-22T18:00:00Z"));
    expect(contiene(bytes, [0x1b, 0x40])).toBe(true);
    expect(contiene(bytes, [0x1d, 0x56])).toBe(true);
  });

  it("no incluye el pulso de gaveta ESC p", () => {
    const bytes = buildTestTicket(new Date("2026-11-22T18:00:00Z"));
    expect(contiene(bytes, [0x1b, 0x70])).toBe(false);
  });
});

describe("página /pos/hardware sin Web Serial", () => {
  it("usa el respaldo del navegador", () => {
    vi.useFakeTimers();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    expect("serial" in navigator).toBe(false);
    expect(isWebSerialSupported()).toBe(false);

    const { container } = render(
      <MemoryRouter initialEntries={["/hardware"]}>
        <PosRoutes />
      </MemoryRouter>,
    );
    const boton = screen.getByRole("button", { name: "Imprimir con el navegador (respaldo)" });
    expect((boton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(boton);
    act(() => {
      vi.runAllTimers();
    });
    expect(container.querySelector(".receipt-80mm")?.textContent).toContain("PRUEBA DE IMPRESORA");
    expect(print).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
