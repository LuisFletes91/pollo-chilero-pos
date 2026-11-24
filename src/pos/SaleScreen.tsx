import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { FOTO_CATEGORIA, PildoraTitulo } from "@/lib/marca";
import { buttonVariants, cn, formatLempiras, round2 } from "@/lib/utils";
import {
  addItem,
  cartTotals,
  cashChange,
  registerSale,
  setQty,
  validatePayments,
  type CartLine,
  type OrderType,
  type PaymentInput,
} from "@/pos/cart";
import { db, type ShiftRow, type StaffRow } from "@/pos/db";
import { NumPad } from "@/pos/NumPad";
import { printSale, reprintSale } from "@/pos/print/print-service";

type Modo = "efectivo" | "transferencia" | "mixto";

const num = (s: string) => (s === "" ? 0 : round2(Number(s)));

function buildPayments(
  modo: Modo,
  total: number,
  efectivo: string,
  referencia: string,
): PaymentInput[] {
  if (modo === "efectivo") {
    return [{ method: "efectivo", amount: total, cashReceived: num(efectivo) }];
  }
  if (modo === "transferencia") {
    return [{ method: "transferencia", amount: total, transferReference: referencia }];
  }
  const cash = num(efectivo);
  const resto = round2(total - cash);
  const pagos: PaymentInput[] = [];
  if (cash > 0) pagos.push({ method: "efectivo", amount: cash, cashReceived: cash });
  if (resto !== 0) {
    pagos.push({ method: "transferencia", amount: resto, transferReference: referencia });
  }
  return pagos;
}

function PaymentDialog(props: {
  total: number;
  onCancel: () => void;
  onConfirm: (payments: PaymentInput[]) => Promise<void>;
}) {
  const { total, onCancel, onConfirm } = props;
  const [modo, setModo] = useState<Modo>("efectivo");
  const [efectivo, setEfectivo] = useState("");
  const [referencia, setReferencia] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pagos = buildPayments(modo, total, efectivo, referencia);
  const invalido = validatePayments(total, pagos);
  const transferencia = round2(total - num(efectivo));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cobro-titulo"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-lg space-y-4 rounded-xl border-4 border-primary bg-surface p-6 text-foreground">
        <h2 id="cobro-titulo" className="text-2xl font-bold text-primary">
          Cobrar {formatLempiras(total)}
        </h2>
        <div role="radiogroup" aria-label="Forma de pago" className="flex gap-2">
          {(
            [
              ["efectivo", "Efectivo"],
              ["transferencia", "Transferencia"],
              ["mixto", "Mixto"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={modo === m}
              className={buttonVariants({
                variant: modo === m ? "secondary" : "ghost",
                size: "pos",
              })}
              onClick={() => {
                setModo(m);
                setEfectivo("");
                setError(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {modo !== "transferencia" && (
          <div className="space-y-2">
            <p>
              {modo === "efectivo" ? "Recibido" : "Efectivo"}:{" "}
              <output aria-label={modo === "efectivo" ? "Recibido" : "Monto en efectivo"}>
                {formatLempiras(num(efectivo))}
              </output>
            </p>
            <NumPad
              label="Teclado numérico"
              value={efectivo}
              onChange={setEfectivo}
              onExact={modo === "efectivo" ? () => setEfectivo(total.toFixed(2)) : undefined}
            />
            {modo === "efectivo" && (
              <p className="text-3xl font-bold">
                Cambio:{" "}
                <output aria-label="Cambio">
                  {formatLempiras(cashChange(total, num(efectivo)))}
                </output>
              </p>
            )}
          </div>
        )}

        {modo === "mixto" && <p>Transferencia: {formatLempiras(transferencia)}</p>}

        {modo !== "efectivo" && (
          <label className="block">
            <span className="font-bold">Referencia de transferencia</span>
            <input
              className="mt-1 w-full rounded-lg border border-border p-3 text-lg"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
            />
          </label>
        )}

        {invalido && <p className="text-muted-foreground">{invalido}</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            className={buttonVariants({ variant: "ghost", size: "lg" })}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={invalido !== null || enviando}
            className={buttonVariants({ size: "lg" })}
            onClick={async () => {
              setEnviando(true);
              try {
                await onConfirm(pagos);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setEnviando(false);
              }
            }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

export function SaleScreen(props: { cashier: StaffRow; shift: ShiftRow }) {
  const { cashier, shift } = props;
  const categorias = useLiveQuery(() => db.categories.orderBy("sortOrder").toArray(), []);
  const [activa, setActiva] = useState<string | null>(null);
  const categoria = activa ?? categorias?.[0]?.code ?? null;
  const productos = useLiveQuery(
    async () =>
      categoria
        ? (await db.products.where("categoryCode").equals(categoria).toArray())
            .filter((p) => p.active)
            .sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    [categoria],
  );
  const [carrito, setCarrito] = useState<CartLine[]>([]);
  const [tipo, setTipo] = useState<OrderType | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmarCopia, setConfirmarCopia] = useState(false);
  const ultima = useLiveQuery(() => db.sales.orderBy("receiptNumber").last(), []);
  const totales = cartTotals(carrito);

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-background p-4 text-foreground lg:flex-row">
      <h1 className="sr-only">Caja — Venta</h1>
      <section className="flex-1 space-y-4" aria-label="Productos">
        <div role="tablist" aria-label="Categorías" className="flex flex-wrap gap-2">
          {categorias?.map((c) => (
            <button
              key={c.code}
              type="button"
              role="tab"
              aria-selected={c.code === categoria}
              className={cn(
                "flex min-h-18 items-center gap-2 rounded-xl border-2 px-3 py-2 font-bold",
                c.code === categoria
                  ? "border-primary bg-accent text-xl text-accent-foreground"
                  : "border-primary/30 bg-surface text-lg",
              )}
              onClick={() => setActiva(c.code)}
            >
              {FOTO_CATEGORIA[c.code] && (
                <img
                  src={FOTO_CATEGORIA[c.code]}
                  alt=""
                  width={56}
                  height={48}
                  className="h-12 w-14 rounded-lg object-cover"
                />
              )}
              {c.name}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {productos?.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cn(
                buttonVariants({ variant: "ghost", size: "pos" }),
                "flex-col rounded-xl border-2 border-primary bg-surface text-center",
              )}
              onClick={() => {
                setCarrito((c) => addItem(c, p));
                setAviso(null);
              }}
            >
              <span>{p.name}</span>
              <span className="rounded-full bg-primary px-3 py-0.5 text-primary-foreground">
                {formatLempiras(p.price)}
              </span>
            </button>
          ))}
        </div>
      </section>

      <aside
        aria-label="Carrito"
        className="w-full space-y-4 rounded-xl border-4 border-primary bg-surface p-4 lg:w-96"
      >
        <PildoraTitulo>Pedido</PildoraTitulo>
        {carrito.length === 0 && <p className="text-muted-foreground">Sin productos</p>}
        <ul className="space-y-2">
          {carrito.map((l) => (
            <li key={l.productId} className="flex items-center gap-2">
              <span className="flex-1">{l.name}</span>
              <button
                type="button"
                aria-label={`Quitar uno de ${l.name}`}
                className={buttonVariants({ variant: "ghost", size: "pos" })}
                onClick={() => setCarrito((c) => setQty(c, l.productId, l.qty - 1))}
              >
                −
              </button>
              <span aria-label={`Cantidad de ${l.name}`} className="w-8 text-center font-bold">
                {l.qty}
              </span>
              <button
                type="button"
                aria-label={`Agregar uno de ${l.name}`}
                className={buttonVariants({ variant: "ghost", size: "pos" })}
                onClick={() => setCarrito((c) => setQty(c, l.productId, l.qty + 1))}
              >
                +
              </button>
            </li>
          ))}
        </ul>
        <p className="text-5xl font-bold text-primary" aria-label="Total">
          {formatLempiras(totales.total)}
        </p>
        <p className="text-muted-foreground">
          ISV incluido: <span aria-label="ISV incluido">{formatLempiras(totales.isv)}</span>
        </p>
        <div role="radiogroup" aria-label="Tipo de pedido" className="flex gap-2">
          {(
            [
              ["comer_aqui", "Comer aquí"],
              ["para_llevar", "Para llevar"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tipo === t}
              className={buttonVariants({
                variant: tipo === t ? "secondary" : "ghost",
                size: "pos",
              })}
              onClick={() => setTipo(t)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={carrito.length === 0 || tipo === null}
          className={cn(buttonVariants({ size: "pos" }), "w-full text-2xl")}
          onClick={() => setCobrando(true)}
        >
          Cobrar
        </button>
        {aviso && (
          <p role="status" className="font-bold text-success">
            {aviso}
          </p>
        )}
        {ultima &&
          (confirmarCopia ? (
            <div className="space-y-2" role="group" aria-label="Confirmar reimpresión">
              <p>¿Reimprimir {ultima.receiptCode} como COPIA?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={buttonVariants({ size: "pos" })}
                  onClick={() => {
                    setConfirmarCopia(false);
                    reprintSale(ultima, cashier.id).catch((e: unknown) =>
                      setAviso(
                        `No se pudo reimprimir: ${e instanceof Error ? e.message : String(e)}`,
                      ),
                    );
                  }}
                >
                  Sí, reimprimir
                </button>
                <button
                  type="button"
                  className={buttonVariants({ variant: "ghost", size: "pos" })}
                  onClick={() => setConfirmarCopia(false)}
                >
                  No
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={cn(buttonVariants({ variant: "ghost", size: "pos" }), "w-full")}
              onClick={() => setConfirmarCopia(true)}
            >
              Reimprimir último
            </button>
          ))}
      </aside>

      {cobrando && tipo && (
        <PaymentDialog
          total={totales.total}
          onCancel={() => setCobrando(false)}
          onConfirm={async (payments) => {
            const sale = await registerSale({
              cart: carrito,
              orderType: tipo,
              payments,
              cashier,
              shift,
            });
            setCarrito([]);
            setTipo(null);
            setCobrando(false);
            setAviso(`Recibo ${sale.receiptCode} registrado`);
            // La venta ya está guardada: un fallo de impresión no la revierte.
            printSale(sale, { copy: false }).catch((e: unknown) =>
              setAviso(
                `Recibo ${sale.receiptCode} registrado. No se pudo imprimir: ${e instanceof Error ? e.message : String(e)}`,
              ),
            );
          }}
        />
      )}
    </main>
  );
}
