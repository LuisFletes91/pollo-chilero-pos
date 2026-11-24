import { useState, type FormEvent } from "react";
import { hashPin, newSalt } from "@/lib/pin";
import { buttonVariants, toLocalHN } from "@/lib/utils";
import { CatalogSection, SettingsSection } from "@/panel/AdminCatalog";
import { firstError, staffSchema } from "@/panel/forms";
import { campo, Mensaje, Section, useList, useRpc } from "@/panel/InventoryPage";
import { usePanelUser } from "@/panel/PanelGuard";

type Staff = {
  id: string;
  display_name: string;
  role: "cajero" | "supervisor" | "socio";
  active: boolean;
  has_pin: boolean;
  has_panel: boolean;
};
type Dispositivo = { id: string; label: string; active: boolean; last_seen_at: string | null };
type Msg = { error?: string; ok?: string };

export const PIN_ITERATIONS = 210_000;
const errorDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const VACIO = { id: "", displayName: "", role: "cajero" as Staff["role"], active: true, pin: "" };

function StaffSection() {
  const staff = useList<Staff>("staff");
  const guardar = useRpc("upsert_staff", ["staff"]);
  const vincular = useRpc("link_staff_by_email", ["staff"]);
  const [v, setV] = useState(VACIO);
  const [correo, setCorreo] = useState({ staffId: "", email: "" });
  const [msg, setMsg] = useState<Msg>({});

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const r = staffSchema.safeParse({ ...v, id: v.id || undefined });
    if (!r.success) return setMsg({ error: firstError(r.error) });
    try {
      // El PIN se convierte en sal + hash aquí; nunca viaja en claro.
      let pin: { p_pin_salt: string; p_pin_hash: string; p_pin_iterations: number } | object = {};
      if (r.data.pin) {
        const salt = newSalt();
        pin = {
          p_pin_salt: salt,
          p_pin_hash: await hashPin(r.data.pin, salt, PIN_ITERATIONS),
          p_pin_iterations: PIN_ITERATIONS,
        };
      }
      await guardar.mutateAsync({
        p_id: r.data.id ?? null,
        p_display_name: r.data.displayName,
        p_role: r.data.role,
        p_active: r.data.active,
        ...pin,
      });
      setV(VACIO);
      setMsg({ ok: "Personal guardado" });
    } catch (err) {
      setMsg({ error: errorDe(err) });
    }
  };

  const enlazar = async (e: FormEvent) => {
    e.preventDefault();
    if (!correo.staffId || !/^\S+@\S+\.\S+$/.test(correo.email.trim())) {
      return setMsg({ error: "Elija la persona y escriba un correo válido" });
    }
    try {
      await vincular.mutateAsync({ p_staff_id: correo.staffId, p_email: correo.email.trim() });
      setMsg({ ok: "Correo vinculado al panel" });
    } catch (err) {
      setMsg({ error: errorDe(err) });
    }
  };

  return (
    <Section title="Personal">
      <ul className="divide-y divide-border">
        {staff.data?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="flex-1">
              {s.display_name} · {s.role}
              {!s.active && " (inactivo)"}
              {s.has_pin && " · PIN"}
              {s.has_panel && " · panel"}
            </span>
            <button
              type="button"
              className={buttonVariants({ variant: "ghost" })}
              onClick={() =>
                setV({
                  id: s.id,
                  displayName: s.display_name,
                  role: s.role,
                  active: s.active,
                  pin: "",
                })
              }
            >
              Editar {s.display_name}
            </button>
          </li>
        ))}
      </ul>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => void enviar(e)}>
        <label>
          Nombre
          <input
            className={campo}
            value={v.displayName}
            onChange={(e) => setV({ ...v, displayName: e.target.value })}
          />
        </label>
        <label>
          Rol
          <select
            className={campo}
            value={v.role}
            onChange={(e) => setV({ ...v, role: e.target.value as Staff["role"] })}
          >
            <option value="cajero">Cajero</option>
            <option value="supervisor">Supervisor</option>
            <option value="socio">Socio</option>
          </select>
        </label>
        <label>
          PIN de 4 dígitos {v.id && "(vacío = sin cambio)"}
          <input
            className={campo}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={4}
            value={v.pin}
            onChange={(e) => setV({ ...v, pin: e.target.value.replace(/\D/g, "").slice(0, 4) })}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={v.active}
            onChange={(e) => setV({ ...v, active: e.target.checked })}
          />
          Activo
        </label>
        <div className="sm:col-span-2 flex gap-2">
          <button type="submit" className={buttonVariants()} disabled={guardar.isPending}>
            {v.id ? "Guardar cambios" : "Crear persona"}
          </button>
          {v.id && (
            <button
              type="button"
              className={buttonVariants({ variant: "ghost" })}
              onClick={() => setV(VACIO)}
            >
              Cancelar edición
            </button>
          )}
        </div>
      </form>
      <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => void enlazar(e)}>
        <label>
          Persona del panel
          <select
            className={campo}
            value={correo.staffId}
            onChange={(e) => setCorreo({ ...correo, staffId: e.target.value })}
          >
            <option value="">Elija…</option>
            {staff.data
              ?.filter((s) => s.role !== "cajero")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Correo
          <input
            className={campo}
            type="email"
            value={correo.email}
            onChange={(e) => setCorreo({ ...correo, email: e.target.value })}
          />
        </label>
        <div className="self-end">
          <button type="submit" className={buttonVariants({ variant: "ghost" })}>
            Vincular correo
          </button>
        </div>
      </form>
      <Mensaje {...msg} />
    </Section>
  );
}

function DevicesSection() {
  const dispositivos = useList<Dispositivo>("dispositivos");
  const generar = useRpc("create_pairing_code", ["dispositivos"]);
  const activar = useRpc("set_device_active", ["dispositivos"]);
  const [label, setLabel] = useState("");
  const [codigo, setCodigo] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>({});

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    if (label.trim().length === 0) return setMsg({ error: "Indique el nombre de la caja" });
    try {
      const r = (await generar.mutateAsync({ p_label: label.trim() })) as { code: string };
      setCodigo(r.code);
      setMsg({});
    } catch (err) {
      setMsg({ error: errorDe(err) });
    }
  };

  return (
    <Section title="Cajas">
      <ul className="divide-y divide-border">
        {dispositivos.data?.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="flex-1">
              {d.label} · {d.active ? "activa" : "inactiva"} ·{" "}
              {d.last_seen_at
                ? `vista ${toLocalHN(d.last_seen_at).fecha} ${toLocalHN(d.last_seen_at).hora}`
                : "nunca vista"}
            </span>
            <button
              type="button"
              className={buttonVariants({ variant: d.active ? "danger" : "ghost" })}
              onClick={() => activar.mutate({ p_device_id: d.id, p_active: !d.active })}
            >
              {d.active ? `Desactivar ${d.label}` : `Activar ${d.label}`}
            </button>
          </li>
        ))}
      </ul>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => void crear(e)}>
        <label>
          Nombre de la caja
          <input className={campo} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button type="submit" className={buttonVariants()} disabled={generar.isPending}>
          Generar código de emparejamiento
        </button>
      </form>
      {codigo && (
        <p role="status" className="text-2xl font-bold">
          Código: <span className="font-mono tracking-widest">{codigo}</span>{" "}
          <span className="text-base font-normal">(vence en 15 minutos)</span>
        </p>
      )}
      <Mensaje {...msg} />
    </Section>
  );
}

function AuditSection() {
  const verificar = useRpc("verify_audit_chain", []);
  const r = verificar.data as
    { ok: boolean; first_bad_id: number | null; checked: number } | undefined;
  return (
    <Section title="Bitácora">
      <button
        type="button"
        className={buttonVariants({ variant: "ghost" })}
        onClick={() => verificar.mutate({})}
      >
        Verificar bitácora
      </button>
      {r && (
        <p role="status" className={r.ok ? "text-success" : "font-bold text-destructive"}>
          {r.ok
            ? `Bitácora íntegra: ${r.checked} registros`
            : `ALTERADA en el registro ${r.first_bad_id}`}
        </p>
      )}
      {verificar.isError && <Mensaje error={errorDe(verificar.error)} />}
    </Section>
  );
}

export function AdminPage() {
  const user = usePanelUser();
  if (user.role !== "supervisor") {
    return <p role="alert">Solo los supervisores pueden administrar.</p>;
  }
  return (
    <div className="space-y-4">
      <StaffSection />
      <DevicesSection />
      <CatalogSection />
      <SettingsSection />
      <AuditSection />
    </div>
  );
}
