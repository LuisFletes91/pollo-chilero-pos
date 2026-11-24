import { useLiveQuery } from "dexie-react-hooks";
import { useBackend } from "@/lib/backend";
import { buttonVariants, cn, toLocalHN } from "@/lib/utils";
import { getMeta } from "@/pos/db";
import { syncOnce, type SyncEstado, type SyncState } from "@/pos/sync";

const ETIQUETA: Record<SyncEstado, string> = {
  sincronizado: "Sincronizado",
  sincronizando: "Sincronizando…",
  sin_conexion: "Sin conexión",
  error: "Error",
};

const COLOR: Record<SyncEstado, string> = {
  sincronizado: "bg-success text-white",
  sincronizando: "bg-surface text-foreground",
  sin_conexion: "bg-warning text-white",
  error: "bg-destructive text-white",
};

export function SyncIndicator() {
  const backend = useBackend("pos");
  const datos = useLiveQuery(async () => ({
    sync: await getMeta<SyncState>("syncState"),
    persisted: await getMeta<boolean>("storagePersisted"),
  }));
  const s: SyncState = datos?.sync ?? { estado: "sincronizado", pendientes: 0, rechazados: 0 };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-lg px-3 py-1 font-bold", COLOR[s.estado])}>
          {ETIQUETA[s.estado]}
        </span>
        <span>{s.pendientes} pendientes</span>
        {s.rechazados > 0 && <span className="font-bold">{s.rechazados} rechazados</span>}
        {s.ultimaSincronizacion && (
          <span>Última sincronización {toLocalHN(s.ultimaSincronizacion).hora}</span>
        )}
      </div>
      <button
        type="button"
        className={buttonVariants({ variant: "ghost" })}
        onClick={() => void syncOnce(backend)}
      >
        Reintentar ahora
      </button>
      {datos?.persisted === false && (
        <p role="alert" className="w-full font-bold text-destructive">
          El navegador puede borrar datos: no limpie el historial
        </p>
      )}
    </div>
  );
}
