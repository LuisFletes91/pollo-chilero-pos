import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { getBackend, resetBackendForTests } from "@/lib/backend";
import { toBackendError } from "@/lib/backend-impl";
import { parseEnv } from "@/lib/env";
import { formatLempiras, toLocalHN } from "@/lib/utils";

afterEach(() => {
  resetBackendForTests();
});

describe("env", () => {
  it.each(["", "no-es-url"])("rechaza VITE_SUPABASE_URL = %j", (url) => {
    expect(() => parseEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: "x" })).toThrow(
      /VITE_SUPABASE_URL/,
    );
  });
});

describe("backend", () => {
  it("crea los clientes pos y panel sin red", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const pos = getBackend("pos");
    const panel = getBackend("panel");
    expect(pos).not.toBe(panel);
    expect(getBackend("pos")).toBe(pos);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normaliza el código de error", () => {
    const e = toBackendError({ message: "CODIGO_INVALIDO: x" });
    expect(e.code).toBe("CODIGO_INVALIDO");
    expect(toBackendError(new TypeError("Failed to fetch")).code).toBe("RED");
  });
});

describe("utilidades", () => {
  it("formatea lempiras sin Intl", () => {
    expect(formatLempiras(1234.5)).toBe("L 1,234.50");
    expect(formatLempiras(0)).toBe("L 0.00");
    expect(formatLempiras(1234567.891)).toBe("L 1,234,567.89");
  });

  it("convierte a hora de Honduras", () => {
    expect(toLocalHN("2026-11-22T16:00:00.000Z")).toEqual({ fecha: "2026-11-22", hora: "10:00" });
  });
});

describe("App", () => {
  it.each([
    ["/pos", /Caja/],
    ["/panel", /Panel de socios/],
  ])("%s mantiene su encabezado", (ruta, nombre) => {
    render(
      <MemoryRouter initialEntries={[ruta]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: nombre })).toBeTruthy();
  });
});
