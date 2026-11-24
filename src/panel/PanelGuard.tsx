import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { BackendError, useBackend, type Session } from "@/lib/backend";
import { buttonVariants } from "@/lib/utils";
import { LoginScreen, MfaScreen, PanelShell } from "@/panel/AuthScreens";

export type PanelRole = "socio" | "supervisor";
export type PanelUser = { staffId: string; displayName: string; role: PanelRole };
type WhoAmI = { staff_id: string; display_name: string; role: PanelRole };

const PanelUserContext = createContext<PanelUser | null>(null);

export function usePanelUser(): PanelUser {
  const u = useContext(PanelUserContext);
  if (!u) throw new Error("usePanelUser fuera de PanelGuard");
  return u;
}

export function PanelGuard(props: { children: ReactNode }) {
  const backend = useBackend("panel");
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: () => backend.getSession() });
  const aal2 = session.data?.aal === "aal2" && !session.data.isAnonymous;
  const whoami = useQuery({
    queryKey: ["whoami"],
    queryFn: () => backend.rpc<WhoAmI>("panel_whoami"),
    enabled: aal2,
    retry: false,
  });

  const setSession = (s: Session | null) => {
    qc.setQueryData(["session"], s);
    void qc.invalidateQueries({ queryKey: ["whoami"] });
  };
  const signOut = async () => {
    await backend.signOut();
    qc.clear();
    qc.setQueryData(["session"], null);
  };

  if (session.isPending) {
    return (
      <PanelShell>
        <p className="mt-4">Cargando…</p>
      </PanelShell>
    );
  }
  if (!session.data || session.data.isAnonymous) return <LoginScreen onSession={setSession} />;
  if (!aal2) return <MfaScreen onSession={setSession} onSignOut={() => void signOut()} />;
  if (whoami.isPending) {
    return (
      <PanelShell>
        <p className="mt-4">Cargando…</p>
      </PanelShell>
    );
  }
  if (whoami.isError) {
    const sinAcceso = whoami.error instanceof BackendError && whoami.error.code === "NO_AUTORIZADO";
    return (
      <PanelShell>
        <p role="alert" className="mt-4 text-destructive">
          {sinAcceso ? "Su usuario no tiene acceso al panel" : "No se pudo verificar su acceso"}
        </p>
        <button
          type="button"
          className={buttonVariants({ variant: "ghost" }) + " mt-4"}
          onClick={() => void signOut()}
        >
          Cerrar sesión
        </button>
      </PanelShell>
    );
  }
  const user: PanelUser = {
    staffId: whoami.data.staff_id,
    displayName: whoami.data.display_name,
    role: whoami.data.role,
  };
  return <PanelUserContext.Provider value={user}>{props.children}</PanelUserContext.Provider>;
}
