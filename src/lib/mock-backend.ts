// Backend SIMULADO para los flujos e2e. Solo entra al build con `--mode e2e-mock` (alias de
// @/lib/backend-impl en vite.config.ts); ningún módulo de src/ lo importa por nombre.
import type { Backend, CreateBackendImpl, Session } from "@/lib/backend";
import {
  CATEGORIAS,
  CODIGO,
  fail,
  hoy,
  ITER,
  load,
  PANEL_USER,
  PRODUCTOS,
  SALT,
  save,
  STAFF,
  staffHashes,
  SUPERVISOR,
  type Evento,
  type State,
} from "@/lib/mock-data";
import { buildZ, cierre, list, summary } from "@/lib/mock-panel";
import { BackendError, round2, toLocalHN } from "@/lib/utils";

function aplicar(s: State, e: Evento): void {
  const p = e.payload;
  if (e.type === "venta") {
    const n = Number(p.receipt_number);
    const pagos = (p.payments as Record<string, unknown>[]).map((x) => ({
      payment_id: String(x.payment_id),
      method: String(x.method),
      amount: Number(x.amount),
      ...(x.method === "transferencia"
        ? { transfer_status: "pendiente", reference: String(x.transfer_reference) }
        : {}),
    }));
    s.sales.push({
      id: String(p.sale_id),
      receipt_code: `R-${String(n).padStart(8, "0")}`,
      total: Number(p.total),
      status: "registrada",
      business_date: toLocalHN(e.client_created_at).fecha,
      payments: pagos,
    });
    if (s.device) s.device.last_receipt_number = Math.max(s.device.last_receipt_number, n);
  } else if (e.type === "anulacion_solicitada") {
    const venta =
      s.sales.find((v) => v.id === p.sale_id) ?? fail("VENTA_NO_ENCONTRADA", String(p.sale_id));
    if (p.approved_by) venta.status = "anulada";
    else
      s.voids.push({
        void_id: String(p.void_id),
        sale_id: venta.id,
        reason: String(p.reason),
        requested_by: e.staff_id,
        status: "pendiente",
      });
  }
}

function pushEvents(s: State, eventos: Evento[]) {
  const resultados = eventos.map((e) => {
    if (s.seen.includes(e.client_seq)) return { client_seq: e.client_seq, estado: "duplicado" };
    try {
      aplicar(s, e);
      s.seen.push(e.client_seq);
      return { client_seq: e.client_seq, estado: "aplicado" };
    } catch (err) {
      s.seen.push(e.client_seq);
      return {
        client_seq: e.client_seq,
        estado: "rechazado",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
  if (s.device) {
    s.device.last_seen_at = new Date().toISOString();
    s.device.last_client_seq = Math.max(
      s.device.last_client_seq,
      ...eventos.map((e) => e.client_seq),
    );
  }
  return { resultados, recibido_en: new Date().toISOString() };
}

function requirePanel(s: State): void {
  if (s.sessions.panel?.aal !== "aal2") fail("MFA_REQUERIDO", "complete la verificación TOTP");
}

async function rpc(s: State, fn: string, a: Record<string, unknown>): Promise<unknown> {
  const fecha = String(a.p_date ?? a.p_from ?? hoy());
  switch (fn) {
    case "pos_claim_device":
      if (String(a.p_code) !== CODIGO) fail("CODIGO_INVALIDO", "código vencido o inexistente");
      s.device = {
        id: crypto.randomUUID(),
        label: String(a.p_label ?? "Caja 1"),
        last_client_seq: 0,
        last_receipt_number: 0,
        last_seen_at: null,
      };
      return { device_id: s.device.id, label: s.device.label };
    case "pos_pull_snapshot": {
      const h = await staffHashes();
      return {
        version: 1,
        unchanged: Number(a.p_since) === 1,
        device: s.device ?? fail("DISPOSITIVO_INVALIDO", "caja sin emparejar"),
        categories: CATEGORIAS,
        products: PRODUCTOS,
        staff: STAFF.map((x) => ({
          id: x.id,
          display_name: x.display_name,
          role: x.role,
          pin_salt: SALT,
          pin_hash: h[x.id],
          pin_iterations: ITER,
        })),
        settings: { printer: { modo: "navegador" }, pin_lockout: { intentos: 5, segundos: 30 } },
      };
    }
    case "pos_push_events":
      return pushEvents(s, a.p_events as Evento[]);
    case "panel_whoami":
      requirePanel(s);
      return {
        staff_id: SUPERVISOR.id,
        display_name: SUPERVISOR.display_name,
        role: SUPERVISOR.role,
      };
    case "panel_summary":
      requirePanel(s);
      return summary(s, String(a.p_from), String(a.p_to));
    case "panel_list":
      requirePanel(s);
      return list(s, String(a.p_kind), fecha);
    case "decide_void": {
      requirePanel(s);
      const v =
        s.voids.find((x) => x.void_id === a.p_void_id) ?? fail("ANULACION_INVALIDA", "no existe");
      v.status = a.p_approve ? "aprobada" : "rechazada";
      const venta = s.sales.find((x) => x.id === v.sale_id);
      if (a.p_approve && venta) venta.status = "anulada";
      return null;
    }
    case "confirm_transfer":
      requirePanel(s);
      for (const p of s.sales.flatMap((v) => v.payments))
        if (p.payment_id === a.p_payment_id) p.transfer_status = "confirmada";
      return null;
    case "my_pin_params":
      requirePanel(s);
      return { pin_salt: SALT, pin_iterations: ITER };
    case "day_close_start":
      requirePanel(s);
      s.closes[fecha] ??= {
        status: "abierto",
        efectivo: false,
        inventario: false,
        ingreso: false,
        contado: 0,
        deposito: null,
        z_report: null,
      };
      return crypto.randomUUID();
    case "day_close_cash_count": {
      const c = cierre(s, fecha);
      c.efectivo = true;
      c.contado = round2(
        Object.entries(a.p_counts as Record<string, number>).reduce(
          (t, [d, n]) => t + Number(d) * n,
          0,
        ),
      );
      return null;
    }
    case "day_close_inventory_count":
      cierre(s, fecha).inventario = true;
      return null;
    case "day_close_deposit": {
      const c = cierre(s, fecha);
      c.ingreso = true;
      c.deposito = {
        tipo: String(a.p_kind),
        monto: Number(a.p_amount),
        recibe: String(a.p_receiver),
      };
      return null;
    }
    case "day_close_finalize": {
      const c = cierre(s, fecha);
      if (a.p_pin_hash !== (await staffHashes())[SUPERVISOR.id])
        fail("PIN_INVALIDO", "el PIN del supervisor no coincide");
      c.z_report = buildZ(s, fecha, c);
      c.status = "cerrado";
      return c.z_report;
    }
    default:
      requirePanel(s);
      return null;
  }
}

export const createBackendImpl: CreateBackendImpl = (kind) => {
  const conEstado = async <T>(fn: (s: State) => Promise<T> | T): Promise<T> => {
    const s = load();
    const r = await fn(s);
    save(s);
    return r;
  };
  const sesion = (aal: Session["aal"], isAnonymous: boolean): Session => ({
    userId: `mock-${kind}`,
    aal,
    isAnonymous,
  });
  const backend: Backend = {
    rpc: <T>(fn: string, args: Record<string, unknown> = {}) => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return Promise.reject(new BackendError("RED", "Sin conexión"));
      }
      return conEstado((s) => rpc(s, fn, args)) as Promise<T>;
    },
    getSession: () => Promise.resolve(load().sessions[kind] ?? null),
    signInAnonymously: () => conEstado((s) => (s.sessions[kind] = sesion("aal1", true))),
    signInWithPassword: (email, password) =>
      conEstado((s) => {
        if (email !== PANEL_USER.email || password !== PANEL_USER.password)
          fail("AUTH", "Invalid login credentials");
        return (s.sessions[kind] = sesion("aal1", false));
      }),
    signOut: () => conEstado((s) => void delete s.sessions[kind]),
    listTotpFactors: () =>
      Promise.resolve(
        load().totpEnrolled ? [{ id: "mock-totp", status: "verified" as const }] : [],
      ),
    enrollTotp: () =>
      Promise.resolve({
        factorId: "mock-totp",
        qrCodeSvg: "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'></svg>",
        secret: "MOCKSECRETMOCKSECRET",
      }),
    verifyTotp: (_factorId, code) =>
      conEstado((s) => {
        if (code !== PANEL_USER.totp) fail("MFA_INVALIDO", "código incorrecto");
        s.totpEnrolled = true;
        return (s.sessions[kind] = sesion("aal2", false));
      }),
    uploadReceiptPhoto: (path) => Promise.resolve(path),
  };
  return backend;
};
