import { expect, test } from "@playwright/test";

/**
 * Verificación §4.4(4) del runbook de T058, la mitad que no necesita sesión.
 *
 * Opt-in y nunca en CI: apunta a producción real, así que se ejecuta solo con PROD_VERIFY=true y
 * BASE_URL=https://bptjersey.pages.dev. Lo que comprueba es estrecho a propósito -que las rutas
 * cargan, que la consola no escupe errores y que /admin rechaza correctamente sin sesión-, y eso NO
 * sustituye la comprobación del operador: un 401 bien devuelto no prueba que las pantallas de staff,
 * familias, CRM, penalizaciones y anuncios funcionen con una sesión de verdad.
 */
const enabled = process.env.PROD_VERIFY === "true";

type Hallazgo = Readonly<{ ruta: string; tipo: string; detalle: string }>;

test.describe("verificacion de produccion sin sesion", () => {
  test.skip(Boolean(process.env.CI) || !enabled, "Opt-in, local-only, apunta a produccion real.");

  for (const ruta of ["/", "/login", "/admin", "/account"]) {
    test(`carga ${ruta} sin errores de consola`, async ({ page }) => {
      const hallazgos: Hallazgo[] = [];

      page.on("console", (mensaje) => {
        if (mensaje.type() === "error") {
          hallazgos.push({ ruta, tipo: "consola", detalle: mensaje.text() });
        }
      });
      page.on("pageerror", (error) => {
        hallazgos.push({ ruta, tipo: "excepcion", detalle: error.message });
      });
      page.on("requestfailed", (peticion) => {
        hallazgos.push({
          ruta,
          tipo: "red",
          detalle: `${peticion.method()} ${peticion.url()} -> ${peticion.failure()?.errorText}`,
        });
      });

      const respuesta = await page.goto(ruta, { waitUntil: "domcontentloaded" });
      expect(respuesta?.status(), `estado HTTP de ${ruta}`).toBeLessThan(400);
      await page.waitForLoadState("networkidle");

      if (hallazgos.length > 0) {
        console.log(
          `[${ruta}] hallazgos:\n` + hallazgos.map((h) => `  - ${h.tipo}: ${h.detalle}`).join("\n"),
        );
      }
      expect(hallazgos, `errores en ${ruta}`).toEqual([]);
    });
  }

  test("/admin rechaza sin sesion en vez de romperse", async ({ page }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    // No se afirma un texto concreto: lo que importa es que la ruta responde con una pantalla y no
    // con un fallo de aplicacion, y que no filtra el armazon de administracion a un anonimo.
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
    await expect(page.locator("body")).not.toBeEmpty();
  });
});
