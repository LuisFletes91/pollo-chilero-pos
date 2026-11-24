import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { BackendError, useBackend } from "@/lib/backend";
import { hashPin } from "@/lib/pin";
import { buttonVariants, cn, formatLempiras, round2, toLocalHN } from "@/lib/utils";
import { TransferenciaItem, type Transferencia } from "@/panel/DashboardPage";
import { depositSchema, firstError, justificacionSchema, pinSchema } from "@/panel/forms";
import { campo, Mensaje, useList, useRpc } from "@/panel/InventoryPage";
import { ZReportView, type ZReport } from "@/panel/ZReportView";

/** Mismas denominaciones que el ajuste `denominations` de la caja. */
export const DENOMINACIONES = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1];
export const PASOS = ["Efectivo", "Inventario", "Transferencias", "Ingreso", "Firma"] as const;

type EstadoCierre = {
  business_date: string;
  status: "abierto" | "cerrado";
  efectivo: boolean;
  inventario: boolean;
  ingreso: boolean;
  z_report: ZReport | null;
} | null;
type Stock = { code: string; name: string; kind: string };
type Msg = { error?: string; ok?: string };
const errorDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

function PasoEfectivo(props: { fecha: string }) {
  const rpc = useRpc("day_close_cash_count", [`cierre`]);
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>({});
  const total = round2(
    DENOMINACIONES.reduce((s, d) => s + d * (Number(conteo[String(d)]) || 0), 0),
  );
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const counts: Record<string, number> = {};
    for (const [d, n] of Object.entries(conteo)) {
      const v = Number(n);
      if (n !== "" && (!Number.isInteger(v) || v < 0))
        return setMsg({ error: `Cantidad inválida para L ${d}` });
      if (v > 0) counts[d] = v;
    }
    try {
      await rpc.mutateAsync({ p_date: props.fecha, p_counts: counts });
      setMsg({ ok: "Conteo de efectivo guardado" });
    } catch (err) {
      setMsg({ error: errorDe(err) });
    }
  };
  return (
    <form className="space-y-3" onSubmit={(e) => void enviar(e)}>
      <p>Cuente el efectivo de la gaveta por denominación.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DENOMINACIONES.map((d) => (
          <label key={d}>
            {formatLempiras(d)}
            <input
              className={campo}
              inputMode="numeric"
              value={conteo[String(d)] ?? ""}
              onChange={(e) => setConteo({ ...conteo, [String(d)]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <p className="text-2xl font-bold">Total contado: {formatLempiras(total)}</p>
      <Mensaje {...msg} />
      <button type="submit" className={buttonVariants()} disabled={rpc.isPending}>
        Guardar conteo de efectivo
      </button>
    </form>
  );
}

function PasoInventario(props: { fecha: string }) {
  const stock = useList<Stock>("stock");
  const items = (stock.data ?? []).filter((i) =>
    ["pieza", "bebida", "desechable"].includes(i.kind),
  );
  const rpc = useRpc("day_close_inventory_count", ["cierre", "stock"]);
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>({});
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const lineas = items.map((i) => ({ item_code: i.code, counted: Number(conteo[i.code] ?? "") }));
    if (items.some((i) => (conteo[i.code] ?? "") === "") || lineas.some((l) => !(l.counted >= 0))) {
      return setMsg({ error: "Cuente todos los ítems (0 o más)" });
    }
    try {
      await rpc.mutateAsync({ p_date: props.fecha, p_lines: lineas });
      setMsg({ ok: "Conteo de inventario guardado" });
    } catch (err) {
      setMsg({ error: errorDe(err) });
    }
  };
  return (
    <form className="space-y-3" onSubmit={(e) => void enviar(e)}>
      <p>Conteo ciego: escriba lo que hay físicamente.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((i) => (
          <label key={i.code}>
            {i.name}
            <input
              className={campo}
              inputMode="decimal"
              value={conteo[i.code] ?? ""}
              onChange={(e) => setConteo({ ...conteo, [i.code]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <Mensaje {...msg} />
      <button
        type="submit"
        className={buttonVariants()}
        disabled={rpc.isPending || items.length === 0}
      >
        Guardar conteo de inventario
      </button>
    </form>
  );
}

function PasoTransferencias(props: { pendientes: Transferencia[] }) {
  if (props.pendientes.length === 0)
    return <p>No quedan transferencias por decidir en esta fecha.</p>;
  return (
    <ul>
      {props.pendientes.map((t) => (
        <TransferenciaItem key={t.payment_id} t={t} supervisor />
      ))}
    </ul>
  );
}

function PasoIngreso(props: { fecha: string }) {
  const backend = useBackend("panel");
  const rpc = useRpc("day_close_deposit", ["cierre"]);
  const [v, setV] = useState({ kind: "", amount: "", receiver: "" });
  const [foto, setFoto] = useState<File | null>(null);
  const [msg, setMsg] = useState<Msg>({});
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const r = depositSchema.safeParse(v);
    if (!r.success) return setMsg({ error: firstError(r.error) });
    try {
      const photo = foto
        ? await backend.uploadReceiptPhoto(`cierres/${props.fecha}.jpg`, foto)
        : null;
      await rpc.mutateAsync({
        p_date: props.fecha,
        p_kind: r.data.kind,
        p_amount: r.data.amount,
        p_receiver: r.data.receiver,
        p_photo_path: photo,
      });
      setMsg({ ok: "Ingreso registrado" });
    } catch (err) {
      setMsg({ error: errorDe(err) });
    }
  };
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => void enviar(e)}>
      <label>
        Tipo de ingreso
        <select
          className={campo}
          value={v.kind}
          onChange={(e) => setV({ ...v, kind: e.target.value })}
        >
          <option value="">Elija…</option>
          <option value="entrega_socio">Entrega a socio</option>
          <option value="deposito_banco">Depósito en banco</option>
        </select>
      </label>
      <label>
        Monto entregado
        <input
          className={campo}
          inputMode="decimal"
          value={v.amount}
          onChange={(e) => setV({ ...v, amount: e.target.value })}
        />
      </label>
      <label>
        Quién recibe
        <input
          className={campo}
          value={v.receiver}
          onChange={(e) => setV({ ...v, receiver: e.target.value })}
        />
      </label>
      <label>
        Foto del comprobante (opcional)
        <input
          className={campo}
          type="file"
          accept="image/*"
          onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
        />
      </label>
      <div className="space-y-2 sm:col-span-2">
        <Mensaje {...msg} />
        <button type="submit" className={buttonVariants()} disabled={rpc.isPending}>
          Guardar ingreso
        </button>
      </div>
    </form>
  );
}

function PasoFirma(props: { fecha: string; onZ: (z: ZReport) => void }) {
  const backend = useBackend("panel");
  const qc = useQueryClient();
  const [pin, setPin] = useState("");
  const [just, setJust] = useState("");
  const [pideJust, setPideJust] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<Msg>({});
  const firmar = async (e: FormEvent) => {
    e.preventDefault();
    const p = pinSchema.safeParse(pin);
    if (!p.success) return setMsg({ error: firstError(p.error) });
    const j = pideJust ? justificacionSchema.safeParse(just) : null;
    if (j && !j.success) return setMsg({ error: firstError(j.error) });
    setEnviando(true);
    try {
      // El PIN se convierte en hash en el navegador con la sal del propio supervisor.
      const params = await backend.rpc<{ pin_salt: string; pin_iterations: number }>(
        "my_pin_params",
      );
      const hash = await hashPin(p.data, params.pin_salt, params.pin_iterations);
      const z = await backend.rpc<ZReport>("day_close_finalize", {
        p_date: props.fecha,
        p_pin_hash: hash,
        ...(j?.success ? { p_justification: j.data } : {}),
      });
      void qc.invalidateQueries({ queryKey: ["list"] });
      props.onZ(z);
    } catch (err) {
      if (err instanceof BackendError && err.code === "JUSTIFICACION_REQUERIDA") {
        setPideJust(true);
        setMsg({ error: "La diferencia de caja supera el umbral: escriba la justificación." });
      } else {
        setMsg({ error: errorDe(err) });
      }
    } finally {
      setEnviando(false);
    }
  };
  return (
    <form className="space-y-3" onSubmit={(e) => void firmar(e)}>
      <label className="block">
        PIN del supervisor
        <input
          className={campo}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
        />
      </label>
      {pideJust && (
        <label className="block">
          Justificación de la diferencia
          <textarea
            className={campo}
            required
            minLength={10}
            value={just}
            onChange={(e) => setJust(e.target.value)}
          />
        </label>
      )}
      <Mensaje {...msg} />
      <button type="submit" className={buttonVariants()} disabled={enviando}>
        Firmar y cerrar el día
      </button>
    </form>
  );
}

export function DayCloseWizard() {
  const backend = useBackend("panel");
  const [fecha, setFecha] = useState(toLocalHN(new Date()).fecha);
  const [iniciado, setIniciado] = useState(false);
  const [paso, setPaso] = useState(0);
  const [z, setZ] = useState<ZReport | null>(null);
  const [msg, setMsg] = useState<Msg>({});
  const estado = useQuery({
    queryKey: ["list", "cierre", fecha],
    queryFn: () => backend.rpc<EstadoCierre>("panel_list", { p_kind: "cierre", p_from: fecha }),
    enabled: iniciado,
  });
  const transf = useList<Transferencia>("transferencias_pendientes");
  const pendientes = (transf.data ?? []).filter(
    (t) => !t.business_date || t.business_date === fecha,
  );
  const e = estado.data;
  const completo = [
    Boolean(e?.efectivo),
    Boolean(e?.inventario),
    Boolean(e?.inventario) && transf.isSuccess && pendientes.length === 0,
    Boolean(e?.ingreso),
    false,
  ];

  const iniciar = async () => {
    try {
      await backend.rpc("day_close_start", { p_date: fecha });
      setIniciado(true);
      setMsg({});
    } catch (err) {
      setMsg({ error: errorDe(err) });
    }
  };

  if (z) return <ZReportView z={z} />;
  if (e?.status === "cerrado" && e.z_report) return <ZReportView z={e.z_report} />;

  if (!iniciado) {
    return (
      <section
        aria-label="Cierre del día"
        className="space-y-3 rounded-xl border-t-4 border-primary bg-surface p-4 shadow-sm"
      >
        <h2 className="text-xl font-bold">Cierre del día</h2>
        <label className="block">
          Fecha
          <input
            className={campo}
            type="date"
            value={fecha}
            onChange={(ev) => setFecha(ev.target.value)}
          />
        </label>
        <Mensaje {...msg} />
        <button type="button" className={buttonVariants()} onClick={() => void iniciar()}>
          Iniciar cierre
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label="Cierre del día"
      className="space-y-4 rounded-xl border-t-4 border-primary bg-surface p-4 shadow-sm"
    >
      <h2 className="text-xl font-bold">Cierre del día {fecha}</h2>
      <ol aria-label="Pasos del cierre" className="flex flex-wrap gap-2">
        {PASOS.map((nombre, i) => (
          <li
            key={nombre}
            aria-current={i === paso ? "step" : undefined}
            className={cn(
              "rounded-lg px-3 py-1",
              i === paso ? "bg-accent font-bold text-accent-foreground" : "bg-background",
            )}
          >
            {i + 1} {nombre}
            {completo[i] && " ✓"}
          </li>
        ))}
      </ol>
      <h3 className="text-lg font-bold">
        Paso {paso + 1}: {PASOS[paso]}
      </h3>
      {paso === 0 && <PasoEfectivo fecha={fecha} />}
      {paso === 1 && <PasoInventario fecha={fecha} />}
      {paso === 2 && <PasoTransferencias pendientes={pendientes} />}
      {paso === 3 && <PasoIngreso fecha={fecha} />}
      {paso === 4 && <PasoFirma fecha={fecha} onZ={setZ} />}
      {paso < 4 && (
        <button
          type="button"
          className={buttonVariants({ size: "lg" })}
          disabled={!completo[paso]}
          onClick={() => setPaso(paso + 1)}
        >
          Siguiente
        </button>
      )}
    </section>
  );
}
