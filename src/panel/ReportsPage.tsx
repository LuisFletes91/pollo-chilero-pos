import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useBackend } from "@/lib/backend";
import { downloadCsv, toCsv, type CsvColumn } from "@/lib/csv";
import { buttonVariants, toLocalHN } from "@/lib/utils";
import { campo, Mensaje, Section } from "@/panel/InventoryPage";
import { ZReportView, type ZReport } from "@/panel/ZReportView";

type Fila = Record<string, unknown>;
type Cierre = { fecha: string; estado: string; z: ZReport | null; z_hash: string | null };

const EXPORTES: { kind: string; titulo: string; columnas: CsvColumn<Fila>[] }[] = [
  {
    kind: "ventas",
    titulo: "Ventas",
    columnas: [
      { key: "recibo", header: "Recibo" },
      { key: "fecha", header: "Fecha" },
      { key: "hora", header: "Hora" },
      { key: "cajero", header: "Cajero" },
      { key: "tipo_pedido", header: "Tipo de pedido" },
      { key: "total", header: "Total" },
      { key: "isv", header: "ISV incluido" },
      { key: "estado", header: "Estado" },
    ],
  },
  {
    kind: "movimientos",
    titulo: "Movimientos de inventario",
    columnas: [
      { key: "fecha", header: "Fecha" },
      { key: "item", header: "Ítem" },
      { key: "tipo", header: "Tipo" },
      { key: "cantidad", header: "Cantidad" },
      { key: "costo_unitario", header: "Costo unitario" },
      { key: "referencia", header: "Referencia" },
      { key: "usuario", header: "Usuario" },
    ],
  },
  {
    kind: "cierres",
    titulo: "Cierres",
    columnas: [
      { key: "fecha", header: "Fecha" },
      { key: "estado", header: "Estado" },
      { key: "z_hash", header: "z_hash" },
    ],
  },
];

function restarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
}

export function ReportsPage() {
  const backend = useBackend("panel");
  const hoy = toLocalHN(new Date()).fecha;
  const [desde, setDesde] = useState(restarDias(hoy, 30));
  const [hasta, setHasta] = useState(hoy);
  const [abierto, setAbierto] = useState<Cierre | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cierres = useQuery({
    queryKey: ["list", "cierres", desde, hasta],
    queryFn: () =>
      backend.rpc<Cierre[]>("panel_list", { p_kind: "cierres", p_from: desde, p_to: hasta }),
    refetchInterval: 60_000,
  });

  const exportar = async (e: (typeof EXPORTES)[number]) => {
    try {
      const filas = await backend.rpc<Fila[]>("panel_list", {
        p_kind: e.kind,
        p_from: desde,
        p_to: hasta,
      });
      downloadCsv(`${e.kind}-${desde}-a-${hasta}.csv`, toCsv(filas, e.columnas));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-4">
      <Section title="Reportes">
        <div className="flex flex-wrap gap-3">
          <label>
            Desde
            <input
              className={campo}
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </label>
          <label>
            Hasta
            <input
              className={campo}
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {EXPORTES.map((e) => (
            <button
              key={e.kind}
              type="button"
              className={buttonVariants({ variant: "ghost" })}
              onClick={() => void exportar(e)}
            >
              Exportar {e.titulo} (CSV)
            </button>
          ))}
        </div>
        <Mensaje error={error} />
      </Section>
      <Section title="Reportes Z">
        {cierres.isPending && <p>Cargando…</p>}
        {cierres.data?.length === 0 && (
          <p className="text-muted-foreground">Sin cierres en el rango</p>
        )}
        <ul className="divide-y divide-border">
          {cierres.data?.map((c) => (
            <li key={c.fecha} className="flex items-center justify-between py-2">
              <span>
                {c.fecha} · {c.estado}
              </span>
              {c.z && (
                <button
                  type="button"
                  className={buttonVariants({ variant: "ghost" })}
                  onClick={() => setAbierto(c)}
                >
                  Ver Z {c.fecha}
                </button>
              )}
            </li>
          ))}
        </ul>
      </Section>
      {abierto?.z && <ZReportView z={abierto.z} hash={abierto.z_hash} />}
    </div>
  );
}
