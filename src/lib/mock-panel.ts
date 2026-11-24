// Lecturas del panel y reporte Z del backend simulado (solo modo e2e-mock).
import { round2 } from "@/lib/utils";
import {
  fail,
  nombreStaff,
  PRODUCTOS,
  STAFF,
  STOCK,
  SUPERVISOR,
  type Cierre,
  type State,
  type Venta,
} from "@/lib/mock-data";

export const validas = (s: State, desde: string, hasta: string) =>
  s.sales.filter(
    (v) => v.status !== "anulada" && v.business_date >= desde && v.business_date <= hasta,
  );
export const sumaPagos = (ventas: Venta[], metodo: string) =>
  round2(
    ventas
      .flatMap((v) => v.payments)
      .filter((x) => x.method === metodo)
      .reduce((a, x) => a + x.amount, 0),
  );

export function summary(s: State, desde: string, hasta: string) {
  const ok = validas(s, desde, hasta);
  const total = round2(ok.reduce((a, v) => a + v.total, 0));
  const anuladas = s.sales.filter(
    (v) => v.status === "anulada" && v.business_date >= desde && v.business_date <= hasta,
  );
  return {
    desde,
    hasta,
    venta_total: total,
    recibos: ok.length,
    ticket_promedio: ok.length ? round2(total / ok.length) : 0,
    por_hora: [],
    por_categoria: [],
    por_forma_pago: {
      efectivo: sumaPagos(ok, "efectivo"),
      transferencia: sumaPagos(ok, "transferencia"),
    },
    diferencias_caja: [],
    merma_piezas: [],
    anulaciones: {
      cantidad: anuladas.length,
      monto: round2(anuladas.reduce((a, v) => a + v.total, 0)),
    },
    reimpresiones: 0,
    aperturas_sin_venta: 0,
    transferencias_pendientes: 0,
    anulaciones_pendientes: s.voids.filter((v) => v.status === "pendiente").length,
    alertas_abiertas: 0,
    cajas: s.device ? [{ ...s.device, active: true }] : [],
  };
}

export function cierre(s: State, fecha: string): Cierre {
  return s.closes[fecha] ?? fail("ORDEN_CIERRE", "inicie el cierre");
}

export function buildZ(s: State, fecha: string, c: Cierre) {
  const ok = validas(s, fecha, fecha);
  const del = s.sales.filter((v) => v.business_date === fecha);
  const total = round2(ok.reduce((a, v) => a + v.total, 0));
  const esperado = sumaPagos(ok, "efectivo");
  const isv = round2(total - round2(total / 1.15));
  const anuladas = del.filter((v) => v.status === "anulada");
  return {
    fecha,
    recibos: {
      primero: del[0]?.receipt_code ?? null,
      ultimo: del.at(-1)?.receipt_code ?? null,
      cantidad: del.length,
    },
    ventas_total: total,
    ventas_por_forma_pago: {
      efectivo: esperado,
      transferencia_confirmada: sumaPagos(ok, "transferencia"),
      transferencia_rechazada: 0,
    },
    ventas_por_categoria: [],
    isv_incluido: {
      gravado_15: round2(total - isv),
      isv_15: isv,
      gravado_18: 0,
      isv_18: 0,
      exento: 0,
    },
    anulaciones: {
      cantidad: anuladas.length,
      monto: round2(anuladas.reduce((a, v) => a + v.total, 0)),
    },
    reimpresiones: 0,
    aperturas_sin_venta: 0,
    consumo_interno: [],
    efectivo: {
      esperado,
      contado: c.contado,
      diferencia: round2(c.contado - esperado),
      justificacion: null,
      por_turno: [],
    },
    transferencias: {
      confirmadas: { cantidad: 0, monto: 0 },
      rechazadas: { cantidad: 0, monto: 0 },
    },
    merma: [],
    ingreso: c.deposito,
    firmado_por: SUPERVISOR.display_name,
    firmado_en: new Date().toISOString(),
  };
}

export function list(s: State, kind: string, fecha: string): unknown {
  switch (kind) {
    case "anulaciones_pendientes":
      return s.voids
        .filter((v) => v.status === "pendiente")
        .map((v) => {
          const venta = s.sales.find((x) => x.id === v.sale_id);
          return {
            void_id: v.void_id,
            receipt_code: venta?.receipt_code,
            total: venta?.total,
            reason: v.reason,
            requested_by: nombreStaff(v.requested_by),
            requested_by_id: v.requested_by,
          };
        });
    case "transferencias_pendientes":
      return s.sales.flatMap((v) =>
        v.payments
          .filter((p) => p.transfer_status === "pendiente")
          .map((p) => ({
            payment_id: p.payment_id,
            receipt_code: v.receipt_code,
            amount: p.amount,
            reference: p.reference,
            business_date: v.business_date,
          })),
      );
    case "cierre": {
      const c = s.closes[fecha];
      return c
        ? {
            business_date: fecha,
            status: c.status,
            efectivo: c.efectivo,
            inventario: c.inventario,
            ingreso: c.ingreso,
            z_report: c.z_report,
          }
        : null;
    }
    case "cierres":
      return Object.entries(s.closes).map(([f, c]) => ({
        fecha: f,
        estado: c.status,
        z: c.z_report,
        z_hash: null,
      }));
    case "ventas":
      return s.sales.map((v) => ({
        recibo: v.receipt_code,
        fecha: v.business_date,
        total: v.total,
        estado: v.status,
      }));
    case "stock":
      return STOCK;
    case "productos":
      return PRODUCTOS;
    case "staff":
      return STAFF.map((x) => ({
        id: x.id,
        display_name: x.display_name,
        role: x.role,
        active: true,
        has_pin: true,
        has_panel: x.role === "supervisor",
      }));
    case "dispositivos":
      return s.device
        ? [
            {
              id: s.device.id,
              label: s.device.label,
              active: true,
              last_seen_at: s.device.last_seen_at,
            },
          ]
        : [];
    default:
      return [];
  }
}
