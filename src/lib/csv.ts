export type CsvColumn<T> = { key: keyof T & string; header: string };

const BOM = "﻿";
const EOL = "\r\n";

/** Celda según RFC 4180: comillas si hay coma, comilla o salto de línea; la comilla se duplica. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Texto CSV UTF-8 con BOM (Excel lo abre con tildes correctas), separador "," y fin de línea CRLF. */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: CsvColumn<T>[],
): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c.key])).join(","));
  return BOM + lines.join(EOL) + EOL;
}

export function downloadCsv(nombre: string, texto: string): void {
  const blob = new Blob([texto], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre.endsWith(".csv") ? nombre : `${nombre}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
