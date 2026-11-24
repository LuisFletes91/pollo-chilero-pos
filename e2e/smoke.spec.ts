import { expect, test } from "@playwright/test";

const rutas: [string, RegExp][] = [
  ["/", /POLLO CHILERO/],
  ["/pos", /Caja/],
  ["/panel", /Panel de socios/],
];

for (const [ruta, nombre] of rutas) {
  test(`humo ${ruta}`, async ({ page }) => {
    await page.goto(ruta);
    await expect(page.getByRole("heading", { level: 1, name: nombre })).toBeVisible();
  });
}
