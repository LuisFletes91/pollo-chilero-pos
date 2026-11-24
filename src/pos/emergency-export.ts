import { toLocalHN } from "@/lib/utils";
import { db } from "@/pos/db";

export type EmergencyExport = {
  exportado_en: string;
  meta: Record<string, unknown>;
  outbox: unknown[];
  sales: unknown[];
  shifts: unknown[];
};

/** Respaldo completo de lo que la caja tiene sin confirmar; no incluye PIN ni hashes del personal. */
export async function buildEmergencyExport(): Promise<EmergencyExport> {
  return db.transaction("r", [db.meta, db.outbox, db.sales, db.shifts], async () => ({
    exportado_en: new Date().toISOString(),
    meta: Object.fromEntries((await db.meta.toArray()).map((m) => [m.key, m.value])),
    outbox: await db.outbox.orderBy("clientSeq").toArray(),
    sales: await db.sales.orderBy("receiptNumber").toArray(),
    shifts: await db.shifts.toArray(),
  }));
}

export function emergencyFileName(now = new Date()): string {
  return `respaldo-caja-${toLocalHN(now).fecha}.json`;
}

/** Genera el JSON y lo descarga en el navegador. Devuelve el Blob generado. */
export async function exportEmergency(): Promise<Blob> {
  const data = await buildEmergencyExport();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  if (typeof URL.createObjectURL === "function") {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = emergencyFileName();
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  return blob;
}
