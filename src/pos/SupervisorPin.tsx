import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { verifyPin } from "@/lib/pin";
import { db, type StaffRow } from "@/pos/db";

/** Selector de supervisor + PIN propio (4 dígitos). onChange recibe el supervisor verificado o null. */
export function SupervisorPin({
  label = "Supervisor que aprueba",
  onChange,
}: {
  label?: string;
  onChange: (s: StaffRow | null) => void;
}) {
  const supervisores = useLiveQuery(() => db.staff.where("role").equals("supervisor").toArray());
  const [id, setId] = useState("");
  const [pin, setPin] = useState("");
  const [estado, setEstado] = useState<"" | "ok" | "mal">("");

  async function verificar(nuevoId: string, nuevoPin: string) {
    setEstado("");
    onChange(null);
    const s = supervisores?.find((x) => x.id === nuevoId);
    if (!s || nuevoPin.length !== 4) return;
    const ok = await verifyPin(nuevoPin, s);
    setEstado(ok ? "ok" : "mal");
    onChange(ok ? s : null);
  }

  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <legend className="px-1 font-bold">{label}</legend>
      <label className="flex flex-col gap-1">
        Supervisor
        <select
          className="rounded-lg border border-border bg-surface p-2"
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            void verificar(e.target.value, pin);
          }}
        >
          <option value="">— Elija —</option>
          {(supervisores ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        PIN del supervisor
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          autoComplete="off"
          className="rounded-lg border border-border bg-surface p-2 font-mono text-xl"
          value={pin}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 4);
            setPin(v);
            void verificar(id, v);
          }}
        />
      </label>
      {estado === "ok" && <p className="text-success">PIN verificado</p>}
      {estado === "mal" && <p className="text-destructive">PIN incorrecto</p>}
    </fieldset>
  );
}
