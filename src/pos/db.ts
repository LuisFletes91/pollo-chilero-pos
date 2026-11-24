import Dexie, { type Table } from "dexie";

export type MetaRow = { key: string; value: unknown };
export type CategoryRow = { code: string; name: string; sortOrder: number };
export type ProductRow = {
  id: string;
  code: string;
  name: string;
  categoryCode: string;
  price: number;
  isvRate: number;
  active: boolean;
  sortOrder: number;
};
export type StaffRow = {
  id: string;
  displayName: string;
  role: "cajero" | "supervisor";
  pinSalt: string;
  pinHash: string;
  pinIterations: number;
};
export type SettingRow = { key: string; value: unknown };
export type OutboxStatus = "pendiente" | "enviando" | "aplicado" | "duplicado" | "rechazado";
export type OutboxRow = {
  clientSeq: number;
  eventId: string;
  type: string;
  staffId: string;
  payload: Record<string, unknown>;
  clientCreatedAt: string;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  ackedAt?: string;
};
export type SaleLineLocal = {
  productId: string;
  code: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};
export type PaymentLocal = {
  paymentId: string;
  method: "efectivo" | "transferencia";
  amount: number;
  cashReceived?: number;
  change?: number;
  transferReference?: string;
};
export type SaleRow = {
  id: string;
  receiptNumber: number;
  receiptCode: string;
  shiftId: string;
  cashierId: string;
  orderType: "comer_aqui" | "para_llevar";
  lines: SaleLineLocal[];
  payments: PaymentLocal[];
  total: number;
  isv: number;
  createdAt: string;
  status: "registrada" | "anulacion_solicitada" | "anulada";
};
export type ShiftRow = {
  id: string;
  cashierId: string;
  status: "abierto" | "cerrado";
  openedAt: string;
  openingFloat: Record<string, number>;
  openingTotal: number;
  approvedBy: string;
  closingCount?: Record<string, number>;
  closedAt?: string;
};
export type PinAttemptRow = { staffId: string; failures: number; lockedUntil?: number };

export class PosDb extends Dexie {
  meta!: Table<MetaRow, string>;
  categories!: Table<CategoryRow, string>;
  products!: Table<ProductRow, string>;
  staff!: Table<StaffRow, string>;
  settings!: Table<SettingRow, string>;
  outbox!: Table<OutboxRow, number>;
  sales!: Table<SaleRow, string>;
  shifts!: Table<ShiftRow, string>;
  pinAttempts!: Table<PinAttemptRow, string>;

  constructor() {
    super("pollo-chilero-pos");
    this.version(1).stores({
      meta: "key",
      categories: "code, sortOrder",
      products: "id, code, categoryCode, active",
      staff: "id, role",
      settings: "key",
      outbox: "clientSeq, status, eventId",
      sales: "id, receiptNumber, shiftId, createdAt, status",
      shifts: "id, status, cashierId",
      pinAttempts: "staffId",
    });
  }
}

export const db = new PosDb();

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
