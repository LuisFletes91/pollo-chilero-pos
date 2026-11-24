import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  amountInWords,
  buildInvoiceLines,
  NUMERO_FISCAL,
  type Invoice,
} from "@/lib/fiscal-invoice";

const factura = (total: number, cliente?: Invoice["cliente"]): Invoice => ({
  emisor: {
    nombreComercial: "POLLO CHILERO",
    razonSocial: "Inversiones de Prueba S. de R.L.",
    rtn: "08019999999999",
    direccion: "Aldea El Ocotal, Olanchito, Yoro",
    telefono: "9999-9999",
    correo: "ventas@ejemplo.hn",
  },
  cai: "ABC123-DEF456-789GHI-JKL012-MNO345-PQ",
  rangoInicial: "001-001-01-00000001",
  rangoFinal: "001-001-01-00005000",
  fechaLimite: "2027-11-22",
  numero: "001-001-01-00000001",
  fecha: "2026-11-22T16:00:00.000Z",
  cliente,
  lines: [{ qty: 1, name: "Combo familiar", lineTotal: total, isvRate: 0.15 }],
});

describe("factura SAR (apagada)", () => {
  it("contiene los campos obligatorios y el desglose de L 1,150.00", () => {
    const lines = buildInvoiceLines(factura(1150));
    const texto = lines.join("\n");
    for (const esperado of [
      "RTN: 08019999999999",
      "CAI: ABC123-DEF456-789GHI-JKL012-MNO345-PQ",
      "001-001-01-00000001 al 001-001-01-00005000",
      "Fecha límite de emisión: 2027-11-22",
      "ORIGINAL: CLIENTE",
      "COPIA: EMISOR",
      "CONSUMIDOR FINAL",
      "MIL CIENTO CINCUENTA LEMPIRAS CON 00/100",
    ]) {
      expect(texto).toContain(esperado);
    }
    const numero = lines.find((l) => l.startsWith("No.: "))?.slice(5) ?? "";
    expect(numero).toMatch(NUMERO_FISCAL);
    expect(lines.find((l) => l.startsWith("GRAVADO 15%"))).toMatch(/L 1,000\.00$/);
    expect(lines.find((l) => l.startsWith("ISV 15%"))).toMatch(/L 150\.00$/);
    expect(lines.find((l) => l.startsWith("TOTAL"))).toMatch(/L 1,150\.00$/);
    expect(lines.every((l) => l.length <= 48)).toBe(true);
  });

  it("exige identidad del cliente sobre L 10,000.00", () => {
    expect(() => buildInvoiceLines(factura(10_500))).toThrow(/^IDENTIDAD_REQUERIDA/);
    expect(() => buildInvoiceLines(factura(10_500, { identidad: "0801199912345" }))).not.toThrow();
  });

  it("escribe montos en letras", () => {
    expect(amountInWords(1150)).toBe("MIL CIENTO CINCUENTA LEMPIRAS CON 00/100");
    expect(amountInWords(1)).toBe("UN LEMPIRA CON 00/100");
    expect(amountInWords(100)).toBe("CIEN LEMPIRAS CON 00/100");
    expect(amountInWords(21.5)).toBe("VEINTIÚN LEMPIRAS CON 50/100");
    expect(amountInWords(253)).toBe("DOSCIENTOS CINCUENTA Y TRES LEMPIRAS CON 00/100");
    expect(amountInWords(21_000)).toBe("VEINTIÚN MIL LEMPIRAS CON 00/100");
    expect(amountInWords(1_234_567.89)).toBe(
      "UN MILLÓN DOSCIENTOS TREINTA Y CUATRO MIL QUINIENTOS SESENTA Y SIETE LEMPIRAS CON 89/100",
    );
  });
});

describe("cabeceras de seguridad", () => {
  it("public/_headers declara CSP, HSTS y las demás cabeceras", () => {
    const h = readFileSync("public/_headers", "utf8");
    for (const c of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Frame-Options: DENY",
      "Referrer-Policy",
      "X-Content-Type-Options: nosniff",
      "Permissions-Policy",
    ]) {
      expect(h).toContain(c);
    }
    expect(h).toContain("img-src 'self' data: blob: https://*.supabase.co");
  });
});
