import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import {
  clearFailures,
  DEFAULT_LOCKOUT,
  lockedUntil,
  registerFailure,
  verifyPin,
  type LockoutPolicy,
} from "@/lib/pin";
import { MarcaBanda } from "@/lib/marca";
import { buttonVariants, cn } from "@/lib/utils";
import { db, type StaffRow } from "@/pos/db";
import { enqueueEvent } from "@/pos/outbox";

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "borrar", "0"] as const;

export function CashierLogin({ onLogin }: { onLogin: (staff: StaffRow) => void }) {
  const staff = useLiveQuery(() =>
    db.staff
      .toArray()
      .then((s) =>
        s
          .filter((x) => (x.role === "cajero" || x.role === "supervisor") && x.pinHash)
          .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      ),
  );
  const policy =
    (useLiveQuery(() => db.settings.get("pin_lockout"))?.value as LockoutPolicy | undefined) ??
    DEFAULT_LOCKOUT;
  const [elegido, setElegido] = useState<StaffRow | null>(null);
  const [pin, setPin] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);

  async function probar(completo: string) {
    if (!elegido) return;
    setVerificando(true);
    try {
      const hasta = await lockedUntil(db.pinAttempts, elegido.id);
      if (hasta) {
        setMensaje(`Bloqueado ${Math.ceil((hasta - Date.now()) / 1000)} s`);
        return;
      }
      if (await verifyPin(completo, elegido)) {
        await clearFailures(db.pinAttempts, elegido.id);
        onLogin(elegido);
        return;
      }
      const bloqueado = await registerFailure(db.pinAttempts, elegido.id, policy);
      if (bloqueado) {
        setMensaje(`Bloqueado ${policy.segundos} s`);
        await enqueueEvent("pin_bloqueado", elegido.id, { blocked_staff_id: elegido.id });
      } else {
        setMensaje("PIN incorrecto");
      }
    } finally {
      setPin("");
      setVerificando(false);
    }
  }

  function tecla(t: string) {
    if (verificando) return;
    if (t === "borrar") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= 4) return;
    const nuevo = pin + t;
    setPin(nuevo);
    if (nuevo.length === 4) void probar(nuevo);
  }

  useEffect(() => {
    if (!elegido) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) tecla(e.key);
      else if (e.key === "Backspace") tecla("borrar");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <MarcaBanda className="-mx-6 -mt-6 mb-6" />
      <h1 className="text-3xl font-bold text-primary">Caja — ¿Quién atiende?</h1>
      {!elegido ? (
        <div className="mt-6 flex flex-wrap gap-4">
          {(staff ?? []).map((s) => (
            <button
              key={s.id}
              type="button"
              className={buttonVariants({ size: "pos" })}
              onClick={() => {
                setElegido(s);
                setPin("");
                setMensaje(null);
              }}
            >
              {s.displayName}
            </button>
          ))}
          {staff && staff.length === 0 && (
            <p className="text-muted-foreground">
              No hay personal con PIN. Configúrelo en el panel.
            </p>
          )}
        </div>
      ) : (
        <section className="mt-6 max-w-xs" aria-label={`PIN de ${elegido.displayName}`}>
          <p className="text-xl font-bold">{elegido.displayName}</p>
          <p className="my-4 font-mono text-4xl tracking-[0.5em]" aria-label="PIN ingresado">
            {"●".repeat(pin.length)}
            <span className="text-border">{"○".repeat(4 - pin.length)}</span>
          </p>
          <div className="grid grid-cols-3 gap-3">
            {TECLAS.map((t) => (
              <button
                key={t}
                type="button"
                className={cn(
                  buttonVariants({ size: "pos", variant: t === "borrar" ? "ghost" : "secondary" }),
                )}
                onClick={() => tecla(t)}
                disabled={verificando}
              >
                {t === "borrar" ? "Borrar" : t}
              </button>
            ))}
          </div>
          {mensaje && (
            <p role="alert" className="mt-4 font-bold text-destructive">
              {mensaje}
            </p>
          )}
          <button
            type="button"
            className={cn(buttonVariants({ variant: "ghost" }), "mt-4")}
            onClick={() => setElegido(null)}
          >
            Volver
          </button>
        </section>
      )}
    </main>
  );
}
