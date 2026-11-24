import Dexie from "dexie";
import { db, type OutboxRow } from "@/pos/db";

type Counts = Record<string, number>;

export type PosEventPayloads = {
  turno_abierto: { shift_id: string; opening_float: Counts; approved_by: string };
  turno_cerrado: { shift_id: string; closing_count: Counts };
  venta: {
    sale_id: string;
    receipt_number: number;
    shift_id: string;
    order_type: "comer_aqui" | "para_llevar";
    total: number;
    lines: { product_id: string; qty: number; unit_price: number }[];
    payments: {
      payment_id: string;
      method: "efectivo" | "transferencia";
      amount: number;
      cash_received?: number;
      transfer_reference?: string;
    }[];
  };
  anulacion_solicitada: { void_id: string; sale_id: string; reason: string; approved_by?: string };
  reimpresion: { reprint_id: string; sale_id: string };
  gaveta_abierta: { opening_id: string; shift_id: string; reason: string };
  consumo_interno: {
    consumption_id: string;
    item_code: string;
    qty: number;
    reason: string;
    approved_by: string;
  };
  pin_bloqueado: { blocked_staff_id: string };
};

export type PosEventType = keyof PosEventPayloads;

/** Debe llamarse dentro de una transacción "rw" que incluya db.meta y db.outbox. */
export async function enqueueEventInTx<T extends PosEventType>(
  type: T,
  staffId: string,
  payload: PosEventPayloads[T],
): Promise<OutboxRow> {
  if (!Dexie.currentTransaction) {
    throw new Error("enqueueEventInTx requiere una transacción rw sobre meta y outbox");
  }
  const last = ((await db.meta.get("lastClientSeq"))?.value as number | undefined) ?? 0;
  const clientSeq = last + 1;
  await db.meta.put({ key: "lastClientSeq", value: clientSeq });
  const row: OutboxRow = {
    clientSeq,
    eventId: crypto.randomUUID(),
    type,
    staffId,
    payload: payload as Record<string, unknown>,
    clientCreatedAt: new Date().toISOString(),
    status: "pendiente",
    attempts: 0,
  };
  await db.outbox.add(row);
  return row;
}

export function enqueueEvent<T extends PosEventType>(
  type: T,
  staffId: string,
  payload: PosEventPayloads[T],
): Promise<OutboxRow> {
  return db.transaction("rw", db.meta, db.outbox, () => enqueueEventInTx(type, staffId, payload));
}

export function pendingEvents(limit = 100): Promise<OutboxRow[]> {
  return db.outbox
    .where("status")
    .anyOf("pendiente", "enviando")
    .sortBy("clientSeq")
    .then((r) => r.slice(0, limit));
}
