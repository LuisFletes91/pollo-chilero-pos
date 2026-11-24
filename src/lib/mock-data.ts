// Datos semilla y estado del backend simulado de los flujos e2e (solo modo e2e-mock).
import type { BackendKind, Session } from "@/lib/backend";
import { hashPin } from "@/lib/pin";
import { BackendError, toLocalHN } from "@/lib/utils";

export const KEY = "pc-mock-state";
export const SALT = "0123456789abcdef0123456789abcdef";
export const ITER = 1000;
export const CODIGO = "MOCK2345";
export const PANEL_USER = { email: "supervisor@prueba.hn", password: "prueba1234", totp: "000000" };
export const STAFF = [
  { id: "00000000-0000-4000-8000-000000000001", display_name: "Ana", role: "cajero", pin: "1111" },
  {
    id: "00000000-0000-4000-8000-000000000002",
    display_name: "Carlos",
    role: "supervisor",
    pin: "2222",
  },
] as const;
export const SUPERVISOR = STAFF[1];

export type Pago = {
  payment_id: string;
  method: string;
  amount: number;
  transfer_status?: string;
  reference?: string;
};
export type Venta = {
  id: string;
  receipt_code: string;
  total: number;
  status: "registrada" | "anulada";
  business_date: string;
  payments: Pago[];
};
export type Cierre = {
  status: "abierto" | "cerrado";
  efectivo: boolean;
  inventario: boolean;
  ingreso: boolean;
  contado: number;
  deposito: { tipo: string; monto: number; recibe: string } | null;
  z_report: Record<string, unknown> | null;
};
export type State = {
  sessions: Partial<Record<BackendKind, Session>>;
  totpEnrolled: boolean;
  device: {
    id: string;
    label: string;
    last_client_seq: number;
    last_receipt_number: number;
    last_seen_at: string | null;
  } | null;
  seen: number[];
  sales: Venta[];
  voids: {
    void_id: string;
    sale_id: string;
    reason: string;
    requested_by: string;
    status: string;
  }[];
  closes: Record<string, Cierre>;
};

export const nuevo = (): State => ({
  sessions: {},
  totpEnrolled: false,
  device: null,
  seen: [],
  sales: [],
  voids: [],
  closes: {},
});

export function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...nuevo(), ...(JSON.parse(raw) as State) } : nuevo();
  } catch {
    return nuevo();
  }
}
export function save(s: State): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export let hashes: Promise<Record<string, string>> | null = null;
export function staffHashes(): Promise<Record<string, string>> {
  hashes ??= Promise.all(
    STAFF.map(async (s) => [s.id, await hashPin(s.pin, SALT, ITER)] as const),
  ).then((pares) => Object.fromEntries(pares));
  return hashes;
}

export const fail = (code: string, detalle: string): never => {
  throw new BackendError(code, `${code}: ${detalle}`);
};
export const nombreStaff = (id: string) => STAFF.find((s) => s.id === id)?.display_name ?? "?";
export const hoy = () => toLocalHN(new Date()).fecha;

export const CATEGORIAS = [
  ["CF", "Combos familiares"],
  ["CP", "Combos personales"],
  ["PZ", "Pollo en piezas"],
  ["CI", "Combos infantiles"],
  ["EX", "Extras"],
  ["BE", "Bebidas"],
].map(([code, name], i) => ({ code, name, sort_order: i + 1 }));
export const PRODUCTOS = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    code: "CF-001",
    name: "2 muslos + 1 pierna + 1 ala + 1 papa + 1 refresco",
    category_code: "CF",
    price: 209,
    isv_rate: 0.15,
    active: true,
    sort_order: 1,
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    code: "PZ-001",
    name: "4 piezas de pollo",
    category_code: "PZ",
    price: 120,
    isv_rate: 0.15,
    active: true,
    sort_order: 1,
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    code: "BE-008",
    name: "12 oz Pepsi, Mirinda, naranja, uva, 7up, Teen",
    category_code: "BE",
    price: 13,
    isv_rate: 0.15,
    active: true,
    sort_order: 8,
  },
];
export const STOCK = [
  { code: "ALA", name: "Ala", kind: "pieza", qty: 20, min_stock: 0 },
  { code: "PECHUGA", name: "Pechuga", kind: "pieza", qty: 20, min_stock: 0 },
  { code: "BE-008", name: "Pepsi 12 oz", kind: "bebida", qty: 24, min_stock: 0 },
];

export type Evento = {
  client_seq: number;
  type: string;
  staff_id: string;
  client_created_at: string;
  payload: Record<string, unknown>;
};
