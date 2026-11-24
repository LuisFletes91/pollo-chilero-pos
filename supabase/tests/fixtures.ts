import type { PGlite } from "@electric-sql/pglite";
import type { Claims } from "./harness";

// Fixtures de prueba: se ejecutan como superusuario de PGlite (ignoran RLS).
export type Pin = { salt: string; hash: string };

export const PIN_PRUEBA: Pin = { salt: "0".repeat(32), hash: "a".repeat(64) };

async function nuevoId(db: PGlite): Promise<string> {
  const r = await db.query<{ id: string }>("select gen_random_uuid()::text as id");
  return r.rows[0]!.id;
}

async function staff(
  db: PGlite,
  name: string,
  role: "cajero" | "supervisor" | "socio",
  authUserId: string | null,
  pin?: Pin,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.staff (display_name, role, auth_user_id, pin_salt, pin_hash)
     values ($1, $2, $3, $4, $5) returning id::text as id`,
    [name, role, authUserId, pin?.salt ?? null, pin?.hash ?? null],
  );
  return r.rows[0]!.id;
}

export type PanelUser = {
  staffId: string;
  uid: string;
  claims: (aal: "aal1" | "aal2") => Claims;
};

export async function panelUser(
  db: PGlite,
  role: "socio" | "supervisor",
  opts?: { pin?: Pin },
): Promise<PanelUser> {
  const uid = await nuevoId(db);
  await db.query("insert into auth.users (id, email) values ($1, $2)", [uid, `${uid}@prueba.hn`]);
  const staffId = await staff(db, `${role} ${uid.slice(0, 4)}`, role, uid, opts?.pin);
  return { staffId, uid, claims: (aal) => ({ sub: uid, aal }) };
}

export function cashier(db: PGlite, name: string, pin?: Pin): Promise<string> {
  return staff(db, name, "cajero", null, pin);
}

export function supervisorStaff(db: PGlite, name: string, pin?: Pin): Promise<string> {
  return staff(db, name, "supervisor", null, pin);
}

export async function anonUser(db: PGlite): Promise<{ uid: string; claims: Claims }> {
  const uid = await nuevoId(db);
  await db.query("insert into auth.users (id, is_anonymous) values ($1, true)", [uid]);
  return { uid, claims: { sub: uid, is_anonymous: true } };
}

export async function device(
  db: PGlite,
  label = "Caja 1",
): Promise<{ deviceId: string; uid: string; claims: Claims }> {
  const { uid } = await anonUser(db);
  const r = await db.query<{ id: string }>(
    `insert into public.devices (location_id, label, auth_user_id)
     select l.id, $1, $2 from public.locations l order by l.created_at limit 1
     returning id::text as id`,
    [label, uid],
  );
  return { deviceId: r.rows[0]!.id, uid, claims: { sub: uid } };
}

// ---------- Eventos de la caja (paso 5) ----------
export type PosEvent = {
  client_seq: number;
  event_id: string;
  type: string;
  staff_id: string;
  client_created_at: string;
  payload: Record<string, unknown>;
};

// 16:00 UTC = 10:00 en Honduras (dentro del horario 09:00–21:00).
export function posEvent(
  seq: number,
  type: string,
  staffId: string,
  payload: Record<string, unknown>,
  at = "2026-11-22T16:00:00.000Z",
): PosEvent {
  return {
    client_seq: seq,
    event_id: crypto.randomUUID(),
    type,
    staff_id: staffId,
    client_created_at: at,
    payload,
  };
}

export function openShiftEvent(
  seq: number,
  cashierId: string,
  approverId: string,
  shiftId: string,
  float: Record<string, number> = { "100": 3, "50": 4 },
): PosEvent {
  return posEvent(seq, "turno_abierto", cashierId, {
    shift_id: shiftId,
    opening_float: float,
    approved_by: approverId,
  });
}

export type SaleLine = { productId: string; qty: number; unitPrice: number };
export type Payment = {
  payment_id: string;
  method: "efectivo" | "transferencia";
  amount: number;
  cash_received?: number;
  transfer_reference?: string;
};

export function saleEvent(
  seq: number,
  cashierId: string,
  shiftId: string,
  opts: {
    receipt: number;
    lines: SaleLine[];
    payments: Payment[];
    orderType?: "comer_aqui" | "para_llevar";
    saleId?: string;
    total?: number;
  },
): PosEvent {
  const total =
    opts.total ?? Math.round(opts.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) * 100) / 100;
  return posEvent(seq, "venta", cashierId, {
    sale_id: opts.saleId ?? crypto.randomUUID(),
    receipt_number: opts.receipt,
    shift_id: shiftId,
    order_type: opts.orderType ?? "comer_aqui",
    total,
    lines: opts.lines.map((l) => ({
      product_id: l.productId,
      qty: l.qty,
      unit_price: l.unitPrice,
    })),
    payments: opts.payments,
  });
}

export async function productId(db: PGlite, code: string): Promise<string> {
  const r = await db.query<{ id: string }>("select id::text as id from products where code = $1", [
    code,
  ]);
  return r.rows[0]!.id;
}
