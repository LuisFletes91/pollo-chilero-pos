import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "@/App";

describe("App", () => {
  it.each([
    ["/", /POLLO CHILERO/],
    ["/pos", /Caja/],
    ["/panel", /Panel de socios/],
  ])("muestra el encabezado de %s", (ruta, nombre) => {
    render(
      <MemoryRouter initialEntries={[ruta]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: nombre })).toBeTruthy();
  });
});
