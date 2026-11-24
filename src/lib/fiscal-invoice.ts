// Factura SAR (Acuerdo 481-2017, art. 10): preparada y APAGADA. Ninguna pantalla la usa mientras
// fiscal_config.activo = false; existe para activarla sin rediseñar cuando el SAR autorice el CAI.
import { formatLempiras, round2, toLocalHN } from "@/lib/utils";

const W = 48;
export const NUMERO_FISCAL = /^\d{3}-\d{3}-\d{2}-\d{8}$/;
export const LIMITE_IDENTIDAD = 10_000;

export type InvoiceLine = { qty: number; name: string; lineTotal: number; isvRate: number };
export type Invoice = {
  emisor: {
    nombreComercial: string;
    razonSocial: string;
    rtn: string;
    direccion: string;
    telefono: string;
    correo: string;
  };
  cai: string;
  rangoInicial: string;
  rangoFinal: string;
  fechaLimite: string;
  numero: string;
  fecha: string;
  cliente?: { nombre?: string; rtn?: string; identidad?: string };
  lines: InvoiceLine[];
};

const center = (t: string) =>
  " ".repeat(Math.max(0, Math.floor((W - t.length) / 2))) + t.slice(0, W);
function leftRight(left: string, right: string): string {
  const max = W - right.length - 1;
  const l = left.length > max ? left.slice(0, max) : left;
  return l + " ".repeat(W - l.length - right.length) + right;
}

const UNIDADES = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
const ESPECIALES = [
  "DIEZ",
  "ONCE",
  "DOCE",
  "TRECE",
  "CATORCE",
  "QUINCE",
  "DIECISÉIS",
  "DIECISIETE",
  "DIECIOCHO",
  "DIECINUEVE",
];
const VEINTES = [
  "VEINTE",
  "VEINTIUNO",
  "VEINTIDÓS",
  "VEINTITRÉS",
  "VEINTICUATRO",
  "VEINTICINCO",
  "VEINTISÉIS",
  "VEINTISIETE",
  "VEINTIOCHO",
  "VEINTINUEVE",
];
const DECENAS = [
  "",
  "",
  "",
  "TREINTA",
  "CUARENTA",
  "CINCUENTA",
  "SESENTA",
  "SETENTA",
  "OCHENTA",
  "NOVENTA",
];
const CENTENAS = [
  "",
  "CIENTO",
  "DOSCIENTOS",
  "TRESCIENTOS",
  "CUATROCIENTOS",
  "QUINIENTOS",
  "SEISCIENTOS",
  "SETECIENTOS",
  "OCHOCIENTOS",
  "NOVECIENTOS",
];

/** 0–999 en palabras ("UNO" al final; el llamador lo apocopa a "UN" cuando corresponde). */
function hasta999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const r = n % 100;
  let resto: string;
  if (r < 10) resto = UNIDADES[r] ?? "";
  else if (r < 20) resto = ESPECIALES[r - 10] ?? "";
  else if (r < 30) resto = VEINTES[r - 20] ?? "";
  else resto = (DECENAS[Math.floor(r / 10)] ?? "") + (r % 10 ? ` Y ${UNIDADES[r % 10]}` : "");
  return [CENTENAS[c], resto].filter(Boolean).join(" ");
}

const apocope = (t: string) => t.replace(/VEINTIUNO$/, "VEINTIÚN").replace(/UNO$/, "UN");

function entero(n: number): string {
  if (n === 0) return "CERO";
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "UN MILLÓN" : `${apocope(entero(millones))} MILLONES`);
  if (miles) partes.push(miles === 1 ? "MIL" : `${apocope(hasta999(miles))} MIL`);
  if (resto) partes.push(hasta999(resto));
  return partes.join(" ");
}

/** "MIL CIENTO CINCUENTA LEMPIRAS CON 00/100". Sin Intl. */
export function amountInWords(n: number): string {
  const centavos = Math.round(round2(n) * 100);
  const lps = Math.floor(centavos / 100);
  const cts = String(centavos % 100).padStart(2, "0");
  const palabras = apocope(entero(lps));
  return `${palabras} ${lps === 1 ? "LEMPIRA" : "LEMPIRAS"} CON ${cts}/100`;
}

export function invoiceTotals(lines: InvoiceLine[]) {
  const t = { gravado15: 0, isv15: 0, gravado18: 0, isv18: 0, exento: 0, total: 0 };
  for (const l of lines) {
    const total = round2(l.lineTotal);
    t.total += total;
    if (l.isvRate === 0) {
      t.exento += total;
      continue;
    }
    const base = round2(total / (1 + l.isvRate));
    if (l.isvRate === 0.18) {
      t.gravado18 += base;
      t.isv18 += total - base;
    } else {
      t.gravado15 += base;
      t.isv15 += total - base;
    }
  }
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, round2(v)])) as typeof t;
}

export function buildInvoiceLines(inv: Invoice): string[] {
  for (const n of [inv.numero, inv.rangoInicial, inv.rangoFinal]) {
    if (!NUMERO_FISCAL.test(n))
      throw new Error(`NUMERO_INVALIDO: ${n} no tiene el formato NNN-NNN-NN-NNNNNNNN`);
  }
  const t = invoiceTotals(inv.lines);
  if (t.total > LIMITE_IDENTIDAD && !inv.cliente?.identidad?.trim()) {
    throw new Error(
      "IDENTIDAD_REQUERIDA: facturas mayores a L 10,000.00 requieren el número de identidad del cliente",
    );
  }
  const { fecha, hora } = toLocalHN(inv.fecha);
  const e = inv.emisor;
  const lines = [
    center(e.nombreComercial),
    center(e.razonSocial),
    center(`RTN: ${e.rtn}`),
    center(e.direccion),
    center(`Tel.: ${e.telefono}  ${e.correo}`),
    center("FACTURA"),
    `No.: ${inv.numero}`,
    `CAI: ${inv.cai}`.slice(0, W),
    "Rango autorizado:",
    `${inv.rangoInicial} al ${inv.rangoFinal}`,
    `Fecha límite de emisión: ${inv.fechaLimite}`,
    `Fecha: ${fecha} ${hora}`,
    `Cliente: ${inv.cliente?.nombre?.trim() || "CONSUMIDOR FINAL"}`.slice(0, W),
  ];
  if (inv.cliente?.rtn) lines.push(`RTN cliente: ${inv.cliente.rtn}`);
  if (inv.cliente?.identidad) lines.push(`Identidad: ${inv.cliente.identidad}`);
  lines.push("-".repeat(W));
  for (const l of inv.lines)
    lines.push(leftRight(`${l.qty} x ${l.name}`, formatLempiras(l.lineTotal)));
  lines.push(
    "-".repeat(W),
    leftRight("GRAVADO 15%", formatLempiras(t.gravado15)),
    leftRight("ISV 15%", formatLempiras(t.isv15)),
    leftRight("GRAVADO 18%", formatLempiras(t.gravado18)),
    leftRight("ISV 18%", formatLempiras(t.isv18)),
    leftRight("EXENTO", formatLempiras(t.exento)),
    leftRight("TOTAL", formatLempiras(t.total)),
    amountInWords(t.total),
    leftRight("ORIGINAL: CLIENTE", "COPIA: EMISOR"),
  );
  return lines;
}
