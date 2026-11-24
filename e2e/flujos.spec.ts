import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// Flujos críticos contra el build `e2e-mock` (backend simulado en el navegador, puerto 4174).
// Los 3 tests comparten contexto y página: cada uno parte del estado que dejó el anterior.
test.describe.serial("flujos críticos", () => {
  let context: BrowserContext;
  let page: Page;
  let panel: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    // Impresión por navegador: se neutraliza el diálogo de impresión del sistema.
    await context.addInitScript(() => {
      window.print = () => undefined;
    });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  const indicador = () => page.getByRole("status").filter({ hasText: "pendientes" });

  test("venta sin conexión → sincronización", async () => {
    await page.goto("/pos");
    await expect(
      page.getByRole("heading", { level: 1, name: /Emparejar esta caja/ }),
    ).toBeVisible();
    await page.getByLabel("Código de emparejamiento").fill("MOCK2345");
    await page.getByRole("button", { name: "Emparejar" }).click();

    await expect(page.getByRole("heading", { level: 1, name: /¿Quién atiende\?/ })).toBeVisible();
    await page.getByRole("button", { name: "Ana", exact: true }).click();
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "1", exact: true }).click();

    await expect(page.getByRole("heading", { level: 1, name: /Abrir turno/ })).toBeVisible();
    await page.getByRole("button", { name: "Agregar L 100.00" }).click();
    await page.getByRole("combobox").selectOption({ label: "Carlos" });
    await page.getByLabel("PIN del supervisor").fill("2222");
    await expect(page.getByText("PIN verificado")).toBeVisible();
    await page.getByRole("button", { name: "Abrir turno" }).click();

    await expect(page.getByRole("tab", { name: "Pollo en piezas" })).toBeVisible();
    await expect(indicador()).toContainText("0 pendientes");

    await context.setOffline(true);
    await page.getByRole("tab", { name: "Pollo en piezas" }).click();
    await page.getByRole("button", { name: /4 piezas de pollo/ }).click();
    await page.getByRole("radio", { name: "Comer aquí" }).click();
    await page.getByRole("button", { name: "Cobrar" }).click();
    const dialogo = page.getByRole("dialog");
    await dialogo.getByRole("button", { name: "Exacto" }).click();
    await dialogo.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Recibo R-00000001 registrado")).toBeVisible();

    await expect(indicador()).toContainText("Sin conexión");
    await expect(indicador()).toContainText("1 pendientes");

    await context.setOffline(false);
    await page.getByRole("button", { name: "Reintentar ahora" }).click();
    await expect(indicador()).toContainText("Sincronizado");
    await expect(indicador()).toContainText("0 pendientes");
  });

  test("anulación → aprobación", async () => {
    await page.getByRole("button", { name: "Acciones de supervisor" }).click();
    await page.getByRole("button", { name: "Solicitar anulación" }).click();
    await page.getByLabel("Motivo de anulación de R-00000001").fill("Cliente canceló el pedido");
    await page.getByRole("button", { name: "Solicitar anulación" }).click();
    await expect(page.getByText("Anulación solicitada", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reintentar ahora" }).click();
    await expect(indicador()).toContainText("0 pendientes");

    panel = await context.newPage();
    await panel.goto("/panel");
    await expect(panel.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await panel.getByLabel("Correo").fill("supervisor@prueba.hn");
    await panel.getByLabel("Contraseña").fill("prueba1234");
    await panel.getByRole("button", { name: "Entrar" }).click();
    await expect(panel.getByAltText(/Código QR/)).toBeVisible();
    await panel.getByLabel("Código de 6 dígitos").fill("000000");
    await panel.getByRole("button", { name: "Verificar" }).click();

    const anulaciones = panel.getByLabel("Anulaciones por decidir");
    await expect(anulaciones).toContainText("R-00000001");
    await anulaciones.getByRole("button", { name: "Aprobar" }).click();
    await expect(anulaciones.getByRole("status")).toHaveText("R-00000001 anulada");
    await expect(anulaciones).toContainText("Sin anulaciones pendientes");
  });

  test("cierre ciego → Z", async () => {
    await page.bringToFront();
    await page.getByRole("button", { name: "Cerrar turno" }).click();
    await page.getByRole("button", { name: "Agregar L 100.00" }).click();
    await page.getByRole("button", { name: "Enviar conteo" }).click();
    await expect(page.getByLabel("Resultado del cierre")).toBeVisible();
    await page.getByRole("button", { name: "Listo" }).click();

    await panel.bringToFront();
    await panel.getByRole("link", { name: "Cierre del día" }).click();
    await panel.getByRole("button", { name: "Iniciar cierre" }).click();
    await expect(panel.getByRole("heading", { name: "Paso 1: Efectivo" })).toBeVisible();
    await expect(panel.getByRole("main")).not.toContainText(/esperado/i);
    const siguiente = panel.getByRole("button", { name: "Siguiente" });
    await expect(siguiente).toBeDisabled();
    await panel.getByLabel("L 100.00", { exact: true }).fill("1");
    await panel.getByRole("button", { name: "Guardar conteo de efectivo" }).click();
    await expect(siguiente).toBeEnabled();
    await siguiente.click();

    await expect(panel.getByRole("heading", { name: "Paso 2: Inventario" })).toBeVisible();
    await panel.getByLabel("Ala", { exact: true }).fill("20");
    await panel.getByLabel("Pechuga", { exact: true }).fill("20");
    await panel.getByLabel("Pepsi 12 oz").fill("24");
    await panel.getByRole("button", { name: "Guardar conteo de inventario" }).click();
    await expect(siguiente).toBeEnabled();
    await siguiente.click();

    await expect(panel.getByRole("heading", { name: "Paso 3: Transferencias" })).toBeVisible();
    await expect(siguiente).toBeEnabled();
    await siguiente.click();

    await expect(panel.getByRole("heading", { name: "Paso 4: Ingreso" })).toBeVisible();
    await panel.getByLabel("Tipo de ingreso").selectOption("entrega_socio");
    await panel.getByLabel("Monto entregado").fill("100");
    await panel.getByLabel("Quién recibe").fill("Luis");
    await panel.getByRole("button", { name: "Guardar ingreso" }).click();
    await expect(siguiente).toBeEnabled();
    await siguiente.click();

    await expect(panel.getByRole("heading", { name: "Paso 5: Firma" })).toBeVisible();
    await panel.getByLabel("PIN del supervisor").fill("2222");
    await panel.getByRole("button", { name: "Firmar y cerrar el día" }).click();
    const z = panel.getByRole("article", { name: /Reporte Z/ });
    await expect(z).toBeVisible();
    await expect(z).toContainText("R-00000001");
    await expect(z).toContainText("Esperado");
    await expect(z.getByRole("button", { name: "Exportar Z (CSV)" })).toBeVisible();
  });
});
