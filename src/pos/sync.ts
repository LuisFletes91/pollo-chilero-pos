import type { CreatingHookContext } from "dexie";
import { BackendError, type Backend } from "@/lib/backend";
import { db, getMeta, setMeta, type OutboxRow, type OutboxStatus } from "@/pos/db";
import { pullSnapshot } from "@/pos/device";

export type SyncEstado = "sincronizado" | "sincronizando" | "sin_conexion" | "error";

export type SyncState = {
  estado: SyncEstado;
  pendientes: number;
  rechazados: number;
  ultimaSincronizacion?: string;
  /** Segundos hasta el próximo reintento automático tras un fallo. */
  reintentoEnSeg?: number;
  ultimoError?: string;
};

type Resultado = {
  client_seq: number;
  estado: "aplicado" | "duplicado" | "rechazado";
  error?: string;
};
type PushResponse = { resultados: Resultado[]; recibido_en: string };

export const BATCH_SIZE = 25;
export const SYNC_INTERVAL_MS = 15_000;
export const SNAPSHOT_INTERVAL_MS = 5 * 60_000;

/** 2, 4, 8 … con tope de 300 s. `fallos` cuenta desde 1. */
export function retryDelaySeconds(fallos: number): number {
  return Math.min(2 ** fallos, 300);
}

let enVuelo: Promise<SyncState> | null = null;
let otraVez = false;
let fallos = 0;
let proximoIntento = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/** Solo para pruebas: olvida el candado, el backoff y el reintento programado. */
export function resetSyncForTests(): void {
  enVuelo = null;
  otraVez = false;
  fallos = 0;
  proximoIntento = 0;
  clearTimeout(retryTimer);
  retryTimer = undefined;
}

const envelope = (e: OutboxRow) => ({
  client_seq: e.clientSeq,
  event_id: e.eventId,
  type: e.type,
  staff_id: e.staffId,
  client_created_at: e.clientCreatedAt,
  payload: e.payload,
});

async function contar(status: OutboxStatus[]): Promise<number> {
  return db.outbox.where("status").anyOf(status).count();
}

async function guardarEstado(parcial: Partial<SyncState>): Promise<SyncState> {
  const previo = await getMeta<SyncState>("syncState");
  const estado: SyncState = {
    estado: "sincronizado",
    ...previo,
    ...parcial,
    pendientes: await contar(["pendiente", "enviando"]),
    rechazados: await contar(["rechazado"]),
  };
  await setMeta("syncState", estado);
  return estado;
}

async function siguienteLote(): Promise<OutboxRow[]> {
  const filas = await db.outbox.where("status").anyOf("pendiente", "enviando").sortBy("clientSeq");
  return filas.slice(0, BATCH_SIZE);
}

async function marcar(filas: OutboxRow[], cambios: Partial<OutboxRow>): Promise<void> {
  await db.outbox.bulkUpdate(filas.map((f) => ({ key: f.clientSeq, changes: cambios })));
}

async function aplicarResultados(lote: OutboxRow[], r: PushResponse): Promise<void> {
  const porSeq = new Map(r.resultados.map((x) => [x.client_seq, x]));
  const ahora = new Date().toISOString();
  await db.transaction("rw", db.outbox, async () => {
    for (const fila of lote) {
      const res = porSeq.get(fila.clientSeq);
      if (!res) {
        await db.outbox.update(fila.clientSeq, { status: "pendiente" });
      } else if (res.estado === "rechazado") {
        await db.outbox.update(fila.clientSeq, {
          status: "rechazado",
          lastError: res.error ?? "RECHAZADO",
          ackedAt: ahora,
        });
      } else {
        await db.outbox.update(fila.clientSeq, { status: res.estado, ackedAt: ahora });
      }
    }
  });
}

function programarReintento(backend: Backend, segundos: number): void {
  clearTimeout(retryTimer);
  proximoIntento = Date.now() + segundos * 1000;
  retryTimer = setTimeout(() => void syncOnce(backend), segundos * 1000);
}

async function ejecutar(backend: Backend): Promise<SyncState> {
  let envio = false;
  for (;;) {
    const lote = await siguienteLote();
    if (lote.length === 0) break;
    await marcar(lote, { status: "enviando" });
    await guardarEstado({ estado: "sincronizando" });
    try {
      const r = await backend.rpc<PushResponse>("pos_push_events", {
        p_events: lote.map(envelope),
      });
      await aplicarResultados(lote, r);
      envio = true;
    } catch (e) {
      await db.transaction("rw", db.outbox, async () => {
        for (const f of lote) {
          await db.outbox.update(f.clientSeq, { status: "pendiente", attempts: f.attempts + 1 });
        }
      });
      fallos += 1;
      const seg = retryDelaySeconds(fallos);
      programarReintento(backend, seg);
      const red = e instanceof BackendError && e.code === "RED";
      return guardarEstado({
        estado: red ? "sin_conexion" : "error",
        reintentoEnSeg: seg,
        ultimoError: e instanceof Error ? e.message : String(e),
      });
    }
  }
  fallos = 0;
  proximoIntento = 0;
  clearTimeout(retryTimer);
  const rechazados = await contar(["rechazado"]);
  return guardarEstado({
    estado: rechazados > 0 ? "error" : "sincronizado",
    reintentoEnSeg: undefined,
    ...(envio ? { ultimaSincronizacion: new Date().toISOString() } : {}),
  });
}

/** Un solo vuelo a la vez; si se pide otra vez durante el vuelo, se repite al terminar. */
export function syncOnce(backend: Backend): Promise<SyncState> {
  if (enVuelo) {
    otraVez = true;
    return enVuelo;
  }
  enVuelo = (async () => {
    let estado: SyncState;
    do {
      otraVez = false;
      estado = await ejecutar(backend);
    } while (otraVez && fallos === 0);
    return estado;
  })().finally(() => {
    enVuelo = null;
  });
  return enVuelo;
}

/** Arranca la sincronización automática; devuelve la función para detenerla. */
export function startSync(backend: Backend): () => void {
  const tick = () => {
    if (Date.now() >= proximoIntento) void syncOnce(backend);
  };
  const ahora = () => void syncOnce(backend);
  // Tras confirmar la transacción que creó el evento, se intenta enviar de inmediato.
  const alCrear = function (this: CreatingHookContext<OutboxRow, number>) {
    this.onsuccess = () => {
      setTimeout(ahora, 0);
    };
  };
  const snapshot = () => {
    pullSnapshot(backend)
      .then(() => guardarEstado({ ultimaSincronizacion: new Date().toISOString() }))
      .catch(() => undefined);
  };

  db.outbox.hook("creating", alCrear);
  window.addEventListener("online", ahora);
  const intervalo = setInterval(tick, SYNC_INTERVAL_MS);
  const intervaloSnapshot = setInterval(snapshot, SNAPSHOT_INTERVAL_MS);
  ahora();

  return () => {
    db.outbox.hook("creating").unsubscribe(alCrear);
    window.removeEventListener("online", ahora);
    clearInterval(intervalo);
    clearInterval(intervaloSnapshot);
  };
}
