import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useBackend } from "@/lib/backend";
import { buttonVariants, cn } from "@/lib/utils";
import {
  cutSchema,
  firstError,
  PIEZAS,
  purchaseSchema,
  recipeSchema,
  type Pieza,
} from "@/panel/forms";
import { usePanelUser } from "@/panel/PanelGuard";

type Stock = { code: string; name: string; kind: string; qty: number; min_stock: number | null };
type Producto = { code: string; name: string };
type RecetaLinea = { product_code: string; item_code: string; qty: number };

export const campo = "mt-1 w-full rounded-lg border border-border bg-surface p-2";
const NOMBRE_PIEZA: Record<Pieza, string> = {
  ALA: "Alas",
  PIERNA: "Piernas",
  MUSLO: "Muslos",
  PECHUGA: "Pechugas",
};

export function useList<T>(kind: string) {
  const backend = useBackend("panel");
  return useQuery({
    queryKey: ["list", kind],
    queryFn: () => backend.rpc<T[]>("panel_list", { p_kind: kind }),
    refetchInterval: 60_000,
  });
}

/** Mutación a una RPC que invalida las listas indicadas y deja un mensaje de resultado. */
export function useRpc(fn: string, invalidar: string[]) {
  const backend = useBackend("panel");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: Record<string, unknown>) => backend.rpc<unknown>(fn, args),
    onSuccess: () => {
      for (const k of invalidar) void qc.invalidateQueries({ queryKey: ["list", k] });
    },
  });
}

export function Section(props: { title: string; children: ReactNode }) {
  return (
    <section aria-label={props.title} className="space-y-3 rounded-xl bg-surface p-4">
      <h2 className="text-xl font-bold">{props.title}</h2>
      {props.children}
    </section>
  );
}

export function Mensaje(props: { error?: string | null; ok?: string | null }) {
  if (props.error) {
    return (
      <p role="alert" className="text-destructive">
        {props.error}
      </p>
    );
  }
  if (props.ok)
    return (
      <p role="status" className="text-success">
        {props.ok}
      </p>
    );
  return null;
}

const errorDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

function PurchaseForm(props: { items: Stock[] }) {
  const backend = useBackend("panel");
  const rpc = useRpc("register_purchase", ["stock", "movimientos"]);
  const [v, setV] = useState({ itemCode: "", qty: "", totalCost: "", supplier: "", pounds: "" });
  const [foto, setFoto] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const r = purchaseSchema.safeParse(v);
    if (!r.success) return setMsg({ error: firstError(r.error) });
    try {
      let photoPath: string | null = null;
      if (foto)
        photoPath = await backend.uploadReceiptPhoto(`compras/${crypto.randomUUID()}.jpg`, foto);
      await rpc.mutateAsync({
        p_item_code: r.data.itemCode,
        p_qty: r.data.qty,
        p_total_cost: r.data.totalCost,
        p_supplier: r.data.supplier,
        p_pounds: r.data.pounds ?? null,
        p_photo_path: photoPath,
      });
      setV({ itemCode: "", qty: "", totalCost: "", supplier: "", pounds: "" });
      setFoto(null);
      setMsg({ ok: "Compra registrada" });
    } catch (err) {
      setMsg({ error: errorDe(err) });
    }
  };

  return (
    <Section title="Registrar compra">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => void enviar(e)}>
        <label>
          Ítem
          <select className={campo} value={v.itemCode} onChange={set("itemCode")}>
            <option value="">Elija…</option>
            {props.items.map((i) => (
              <option key={i.code} value={i.code}>
                {i.code} · {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cantidad
          <input className={campo} inputMode="decimal" value={v.qty} onChange={set("qty")} />
        </label>
        <label>
          Costo total
          <input
            className={campo}
            inputMode="decimal"
            value={v.totalCost}
            onChange={set("totalCost")}
          />
        </label>
        <label>
          Proveedor
          <input className={campo} value={v.supplier} onChange={set("supplier")} />
        </label>
        <label>
          Libras
          <input className={campo} inputMode="decimal" value={v.pounds} onChange={set("pounds")} />
        </label>
        <label>
          Foto de la factura (opcional)
          <input
            className={campo}
            type="file"
            accept="image/*"
            onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="sm:col-span-2 space-y-2">
          <Mensaje {...msg} />
          <button type="submit" className={buttonVariants()} disabled={rpc.isPending}>
            Guardar compra
          </button>
        </div>
      </form>
    </Section>
  );
}

function CutForm() {
  const rpc = useRpc("register_cut", ["stock", "movimientos"]);
  const [pollos, setPollos] = useState("");
  const [piezas, setPiezas] = useState<Record<Pieza, string>>({
    ALA: "",
    PIERNA: "",
    MUSLO: "",
    PECHUGA: "",
  });
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});

  const cambiarPollos = (valor: string) => {
    setPollos(valor);
    const n = Number(valor);
    const p = Number.isInteger(n) && n > 0 ? String(2 * n) : "";
    setPiezas({ ALA: p, PIERNA: p, MUSLO: p, PECHUGA: p });
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const r = cutSchema.safeParse({ chickens: pollos, pieces: piezas });
    if (!r.success) return setMsg({ error: firstError(r.error) });
    try {
      await rpc.mutateAsync({ p_chickens: r.data.chickens, p_pieces: r.data.pieces });
      setMsg({ ok: "Corte registrado" });
      cambiarPollos("");
    } catch (err) {
      setMsg({ error: errorDe(err) });
    }
  };

  return (
    <Section title="Corte">
      <form className="grid gap-3 sm:grid-cols-5" onSubmit={(e) => void enviar(e)}>
        <label>
          Pollos a cortar
          <input
            className={campo}
            inputMode="numeric"
            value={pollos}
            onChange={(e) => cambiarPollos(e.target.value)}
          />
        </label>
        {PIEZAS.map((p) => (
          <label key={p}>
            {NOMBRE_PIEZA[p]}
            <input
              className={campo}
              inputMode="numeric"
              value={piezas[p]}
              onChange={(e) => setPiezas({ ...piezas, [p]: e.target.value })}
            />
          </label>
        ))}
        <div className="sm:col-span-5 space-y-2">
          <Mensaje {...msg} />
          <button type="submit" className={buttonVariants()} disabled={rpc.isPending}>
            Registrar corte
          </button>
        </div>
      </form>
    </Section>
  );
}

type LineaForm = { itemCode: string; qty: string };

function RecipeForm(props: { items: Stock[] }) {
  const productos = useList<Producto>("productos");
  const recetas = useList<RecetaLinea>("recetas");
  const rpc = useRpc("upsert_recipe", ["recetas"]);
  const [producto, setProducto] = useState("");
  const [lineas, setLineas] = useState<LineaForm[]>([]);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});

  const elegir = (code: string) => {
    setProducto(code);
    setMsg({});
    const actuales = (recetas.data ?? []).filter((r) => r.product_code === code);
    setLineas(actuales.map((r) => ({ itemCode: r.item_code, qty: String(r.qty) })));
  };
  const cambiar = (i: number, k: keyof LineaForm, valor: string) =>
    setLineas(lineas.map((l, j) => (j === i ? { ...l, [k]: valor } : l)));

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const r = recipeSchema.safeParse({ productCode: producto, lines: lineas });
    if (!r.success) return setMsg({ error: firstError(r.error) });
    try {
      await rpc.mutateAsync({ p_product_code: r.data.productCode, p_lines: r.data.lines });
      setMsg({ ok: "Receta guardada" });
    } catch (err) {
      setMsg({ error: errorDe(err) });
    }
  };

  return (
    <Section title="Recetas">
      <form className="space-y-3" onSubmit={(e) => void enviar(e)}>
        <label className="block">
          Producto
          <select className={campo} value={producto} onChange={(e) => elegir(e.target.value)}>
            <option value="">Elija…</option>
            {productos.data?.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </label>
        {lineas.map((l, i) => (
          <div key={i} className="grid grid-cols-2 gap-2">
            <label>
              Ítem {i + 1}
              <select
                className={campo}
                value={l.itemCode}
                onChange={(e) => cambiar(i, "itemCode", e.target.value)}
              >
                <option value="">Elija…</option>
                {props.items.map((it) => (
                  <option key={it.code} value={it.code}>
                    {it.code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cantidad {i + 1}
              <input
                className={campo}
                inputMode="decimal"
                value={l.qty}
                onChange={(e) => cambiar(i, "qty", e.target.value)}
              />
            </label>
          </div>
        ))}
        <Mensaje {...msg} />
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonVariants({ variant: "ghost" })}
            disabled={!producto}
            onClick={() => setLineas([...lineas, { itemCode: "", qty: "" }])}
          >
            Agregar línea
          </button>
          <button type="submit" className={buttonVariants()} disabled={!producto || rpc.isPending}>
            Guardar receta
          </button>
        </div>
      </form>
    </Section>
  );
}

export function InventoryPage() {
  const user = usePanelUser();
  const stock = useList<Stock>("stock");
  const items = stock.data ?? [];
  return (
    <div className="space-y-4">
      <Section title="Existencias">
        {stock.isPending && <p>Cargando…</p>}
        {stock.isError && <Mensaje error="No se pudo cargar el inventario" />}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>Código</th>
                <th>Ítem</th>
                <th className="text-right">Existencia</th>
                <th className="text-right">Mínimo</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const bajo = Number(i.min_stock ?? 0) > 0 && Number(i.qty) < Number(i.min_stock);
                return (
                  <tr key={i.code} className={cn(bajo && "font-bold text-destructive")}>
                    <td>{i.code}</td>
                    <td>
                      {i.name}
                      {bajo && " (bajo mínimo)"}
                    </td>
                    <td className="text-right">{Number(i.qty)}</td>
                    <td className="text-right">{i.min_stock ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
      {user.role === "supervisor" && (
        <>
          <PurchaseForm items={items} />
          <CutForm />
          <RecipeForm items={items} />
        </>
      )}
    </div>
  );
}
