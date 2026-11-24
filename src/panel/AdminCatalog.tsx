import { useState, type FormEvent } from "react";
import { buttonVariants, formatLempiras } from "@/lib/utils";
import { firstError, productSchema, settingSchema } from "@/panel/forms";
import { campo, Mensaje, Section, useList, useRpc } from "@/panel/InventoryPage";

type Producto = {
  code: string;
  name: string;
  category_code: string;
  price: number;
  isv_rate: number;
  active: boolean;
};
type Msg = { error?: string; ok?: string };
const errorDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

const CATEGORIAS = [
  ["CF", "Combos familiares"],
  ["CP", "Combos personales"],
  ["PZ", "Pollo en piezas"],
  ["CI", "Combos infantiles"],
  ["EX", "Extras"],
  ["BE", "Bebidas"],
] as const;

function ProductRow(props: { p: Producto; onMsg: (m: Msg) => void }) {
  const { p, onMsg } = props;
  const guardar = useRpc("set_product", ["productos"]);
  const [precio, setPrecio] = useState(String(Number(p.price)));
  const [activo, setActivo] = useState(p.active);
  const enviar = async () => {
    const r = productSchema.safeParse({
      code: p.code,
      categoryCode: p.category_code,
      name: p.name,
      price: precio,
      active: activo,
      isvRate: Number(p.isv_rate),
    });
    if (!r.success) return onMsg({ error: firstError(r.error) });
    try {
      await guardar.mutateAsync({
        p_code: p.code,
        p_name: r.data.name,
        p_price: r.data.price,
        p_active: r.data.active,
        p_isv_rate: r.data.isvRate,
      });
      onMsg({ ok: `${p.code} guardado` });
    } catch (err) {
      onMsg({ error: errorDe(err) });
    }
  };
  return (
    <tr>
      <td>{p.code}</td>
      <td>{p.name}</td>
      <td>
        <input
          aria-label={`Precio ${p.code}`}
          className="w-24 rounded-lg border border-border p-1 text-right"
          inputMode="decimal"
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
        />
      </td>
      <td>
        <input
          aria-label={`Activo ${p.code}`}
          type="checkbox"
          checked={activo}
          onChange={(e) => setActivo(e.target.checked)}
        />
      </td>
      <td>
        <button
          type="button"
          className={buttonVariants({ variant: "ghost" })}
          onClick={() => void enviar()}
        >
          Guardar {p.code}
        </button>
      </td>
    </tr>
  );
}

export function CatalogSection() {
  const productos = useList<Producto>("productos");
  const crear = useRpc("create_product", ["productos"]);
  const [nuevo, setNuevo] = useState({ categoryCode: "", name: "", price: "", isvRate: "0.15" });
  const [msg, setMsg] = useState<Msg>({});

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const r = productSchema.safeParse({ ...nuevo, active: true, isvRate: Number(nuevo.isvRate) });
    if (!r.success) return setMsg({ error: firstError(r.error) });
    try {
      const code = await crear.mutateAsync({
        p_category_code: r.data.categoryCode,
        p_name: r.data.name,
        p_price: r.data.price,
        p_isv_rate: r.data.isvRate,
      });
      setNuevo({ categoryCode: "", name: "", price: "", isvRate: "0.15" });
      setMsg({ ok: `Producto ${String(code)} creado` });
    } catch (err) {
      setMsg({ error: errorDe(err) });
    }
  };

  return (
    <Section title="Productos">
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Precio (L)</th>
              <th>Activo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {productos.data?.map((p) => (
              <ProductRow key={p.code} p={p} onMsg={setMsg} />
            ))}
          </tbody>
        </table>
      </div>
      <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => void enviar(e)}>
        <label>
          Categoría
          <select
            className={campo}
            value={nuevo.categoryCode}
            onChange={(e) => setNuevo({ ...nuevo, categoryCode: e.target.value })}
          >
            <option value="">Elija…</option>
            {CATEGORIAS.map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nombre del producto
          <input
            className={campo}
            value={nuevo.name}
            onChange={(e) => setNuevo({ ...nuevo, name: e.target.value })}
          />
        </label>
        <label>
          Precio con ISV
          <input
            className={campo}
            inputMode="decimal"
            value={nuevo.price}
            onChange={(e) => setNuevo({ ...nuevo, price: e.target.value })}
          />
        </label>
        <label>
          ISV
          <select
            className={campo}
            value={nuevo.isvRate}
            onChange={(e) => setNuevo({ ...nuevo, isvRate: e.target.value })}
          >
            <option value="0.15">15 %</option>
            <option value="0.18">18 %</option>
            <option value="0">Exento</option>
          </select>
        </label>
        <div className="sm:col-span-4">
          <button type="submit" className={buttonVariants()} disabled={crear.isPending}>
            Crear producto
          </button>
        </div>
      </form>
      {nuevo.price !== "" && Number(nuevo.price) > 0 && (
        <p className="text-muted-foreground">Precio final: {formatLempiras(Number(nuevo.price))}</p>
      )}
      <Mensaje {...msg} />
    </Section>
  );
}

export function SettingsSection() {
  const guardar = useRpc("set_setting", []);
  const [v, setV] = useState({ cash: "", waste: "", abre: "", cierra: "" });
  const [msg, setMsg] = useState<Msg>({});

  const enviar = async (input: unknown) => {
    const r = settingSchema.safeParse(input);
    if (!r.success) return setMsg({ error: firstError(r.error) });
    try {
      await guardar.mutateAsync({ p_key: r.data.key, p_value: r.data.value });
      setMsg({ ok: "Ajuste guardado" });
    } catch (err) {
      setMsg({ error: errorDe(err) });
    }
  };

  return (
    <Section title="Ajustes">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <label className="block">
            Umbral de diferencia de caja (L)
            <input
              className={campo}
              inputMode="decimal"
              value={v.cash}
              onChange={(e) => setV({ ...v, cash: e.target.value })}
            />
          </label>
          <button
            type="button"
            className={buttonVariants({ variant: "ghost" })}
            onClick={() => void enviar({ key: "cash_diff_threshold", value: v.cash })}
          >
            Guardar umbral de caja
          </button>
        </div>
        <div className="space-y-2">
          <label className="block">
            Umbral de merma (piezas)
            <input
              className={campo}
              inputMode="numeric"
              value={v.waste}
              onChange={(e) => setV({ ...v, waste: e.target.value })}
            />
          </label>
          <button
            type="button"
            className={buttonVariants({ variant: "ghost" })}
            onClick={() => void enviar({ key: "waste_threshold_pieces", value: v.waste })}
          >
            Guardar umbral de merma
          </button>
        </div>
        <div className="space-y-2">
          <label className="block">
            Abre (HH:MM)
            <input
              className={campo}
              value={v.abre}
              onChange={(e) => setV({ ...v, abre: e.target.value })}
            />
          </label>
          <label className="block">
            Cierra (HH:MM)
            <input
              className={campo}
              value={v.cierra}
              onChange={(e) => setV({ ...v, cierra: e.target.value })}
            />
          </label>
          <button
            type="button"
            className={buttonVariants({ variant: "ghost" })}
            onClick={() =>
              void enviar({ key: "business_hours", value: { abre: v.abre, cierra: v.cierra } })
            }
          >
            Guardar horario
          </button>
        </div>
      </div>
      <Mensaje {...msg} />
    </Section>
  );
}
