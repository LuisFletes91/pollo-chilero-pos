import { useState, type FormEvent } from "react";
import { BackendError, useBackend } from "@/lib/backend";
import { buttonVariants } from "@/lib/utils";
import { pairDevice } from "@/pos/device";

function mensajeError(e: unknown): string {
  if (e instanceof BackendError) {
    if (e.code === "CODIGO_INVALIDO") return "Código inválido o vencido";
    if (e.code === "RED") return "Sin conexión: el emparejamiento necesita internet";
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export function PairingScreen() {
  const backend = useBackend("pos");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("Caja 1");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await pairDevice(backend, code, label);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-md bg-background p-6 text-foreground">
      <h1 className="text-3xl font-bold text-primary">Caja — Emparejar esta caja</h1>
      <p className="mt-2 text-muted-foreground">
        Pida al supervisor un código de emparejamiento en el panel de socios.
      </p>
      <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit}>
        <label className="flex flex-col gap-1 font-bold">
          Código de emparejamiento
          <input
            className="rounded-lg border border-border bg-surface p-3 font-mono text-2xl uppercase tracking-widest"
            value={code}
            maxLength={8}
            minLength={8}
            required
            autoComplete="off"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </label>
        <label className="flex flex-col gap-1 font-bold">
          Nombre de la caja
          <input
            className="rounded-lg border border-border bg-surface p-3 text-lg"
            value={label}
            required
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <button type="submit" className={buttonVariants({ size: "lg" })} disabled={enviando}>
          Emparejar
        </button>
        {error && (
          <p role="alert" className="font-bold text-destructive">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
