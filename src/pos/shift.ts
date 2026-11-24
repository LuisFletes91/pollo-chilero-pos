import { round2 } from "@/lib/utils";
import { db, type SaleRow, type ShiftRow, type StaffRow } from "@/pos/db";
import { enqueueEventInTx } from "@/pos/outbox";

export type Counts = Record<string, number>;

export const DEFAULT_DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1];

export async function denominations(): Promise<number[]> {
  const row = await db.settings.get("denominations");
  return Array.isArray(row?.value) ? (row.value as number[]) : DEFAULT_DENOMINATIONS;
}

export function countTotal(counts: Counts): number {
  return round2(
    Object.entries(counts).reduce((s, [den, n]) => s + Number(den) * (Number(n) || 0), 0),
  );
}

/** Solo denominaciones con cantidad > 0 (el servidor valida enteros ≥ 0). */
function limpiar(counts: Counts): Counts {
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}

function exigirMotivo(reason: string): string {
  const r = reason.trim();
  if (r.length < 5) throw new Error("Escriba el motivo (5 o más caracteres)");
  return r;
}

function exigirOtroSupervisor(actorId: string, approver: StaffRow | null | undefined): StaffRow {
  if (!approver || approver.role !== "supervisor" || approver.id === actorId) {
    throw new Error("Se requiere otro supervisor");
  }
  return approver;
}

export async function currentShift(): Promise<ShiftRow | undefined> {
  return db.shifts.where("status").equals("abierto").first();
}

export async function openShift(
  cashier: StaffRow,
  approver: StaffRow,
  counts: Counts,
): Promise<ShiftRow> {
  exigirOtroSupervisor(cashier.id, approver);
  const opening = limpiar(counts);
  const shift: ShiftRow = {
    id: crypto.randomUUID(),
    cashierId: cashier.id,
    status: "abierto",
    openedAt: new Date().toISOString(),
    openingFloat: opening,
    openingTotal: countTotal(opening),
    approvedBy: approver.id,
  };
  await db.transaction("rw", [db.meta, db.outbox, db.shifts], async () => {
    if (await currentShift()) throw new Error("Ya hay un turno abierto");
    await db.shifts.add(shift);
    await enqueueEventInTx("turno_abierto", cashier.id, {
      shift_id: shift.id,
      opening_float: opening,
      approved_by: approver.id,
    });
  });
  return shift;
}

export async function expectedCash(shiftId: string): Promise<number> {
  const shift = await db.shifts.get(shiftId);
  const ventas = await db.sales.where("shiftId").equals(shiftId).toArray();
  const efectivo = ventas
    .filter((s) => s.status !== "anulada")
    .flatMap((s) => s.payments)
    .filter((p) => p.method === "efectivo")
    .reduce((s, p) => s + p.amount, 0);
  return round2((shift?.openingTotal ?? 0) + efectivo);
}

export async function closeShift(
  shiftId: string,
  counts: Counts,
): Promise<{ esperado: number; contado: number; diferencia: number }> {
  const closing = limpiar(counts);
  const contado = countTotal(closing);
  let esperado = 0;
  await db.transaction("rw", [db.meta, db.outbox, db.shifts, db.sales], async () => {
    const shift = await db.shifts.get(shiftId);
    if (!shift || shift.status !== "abierto") throw new Error("El turno no está abierto");
    esperado = await expectedCash(shiftId);
    await db.shifts.update(shiftId, {
      status: "cerrado",
      closingCount: closing,
      closedAt: new Date().toISOString(),
    });
    await enqueueEventInTx("turno_cerrado", shift.cashierId, {
      shift_id: shiftId,
      closing_count: closing,
    });
  });
  return { esperado, contado, diferencia: round2(contado - esperado) };
}

export async function requestVoid(
  actor: StaffRow,
  sale: SaleRow,
  reason: string,
  approver?: StaffRow | null,
): Promise<void> {
  const motivo = exigirMotivo(reason);
  if (approver) exigirOtroSupervisor(actor.id, approver);
  await db.transaction("rw", [db.meta, db.outbox, db.sales], async () => {
    await db.sales.update(sale.id, { status: approver ? "anulada" : "anulacion_solicitada" });
    await enqueueEventInTx("anulacion_solicitada", actor.id, {
      void_id: crypto.randomUUID(),
      sale_id: sale.id,
      reason: motivo,
      ...(approver ? { approved_by: approver.id } : {}),
    });
  });
}

export async function openDrawer(actor: StaffRow, shiftId: string, reason: string): Promise<void> {
  const motivo = exigirMotivo(reason);
  await db.transaction("rw", [db.meta, db.outbox], () =>
    enqueueEventInTx("gaveta_abierta", actor.id, {
      opening_id: crypto.randomUUID(),
      shift_id: shiftId,
      reason: motivo,
    }),
  );
}

export async function internalConsumption(
  actor: StaffRow,
  itemCode: string,
  qty: number,
  reason: string,
  approver: StaffRow | null,
): Promise<void> {
  const motivo = exigirMotivo(reason);
  const ok = exigirOtroSupervisor(actor.id, approver);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("Cantidad inválida");
  await db.transaction("rw", [db.meta, db.outbox], () =>
    enqueueEventInTx("consumo_interno", actor.id, {
      consumption_id: crypto.randomUUID(),
      item_code: itemCode,
      qty,
      reason: motivo,
      approved_by: ok.id,
    }),
  );
}
