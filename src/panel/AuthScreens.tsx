import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";
import { useBackend, type Session } from "@/lib/backend";
import { buttonVariants } from "@/lib/utils";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
const codigoSchema = z.string().regex(/^\d{6}$/);

const campo = "mt-1 w-full rounded-lg border border-border bg-surface p-3 text-lg";

export function PanelShell(props: { subtitle?: string; children?: ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-md bg-background p-6 text-foreground">
      <h1 className="text-3xl font-bold text-primary">Panel de socios</h1>
      {props.subtitle && <h2 className="mt-2 text-xl font-bold">{props.subtitle}</h2>}
      {props.children}
    </main>
  );
}

export function LoginScreen(props: { onSession: (s: Session) => void }) {
  const backend = useBackend("panel");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useMutation({
    mutationFn: (v: z.infer<typeof loginSchema>) => backend.signInWithPassword(v.email, v.password),
    onSuccess: props.onSession,
    onError: () => setError("Correo o contraseña incorrectos"),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const v = loginSchema.safeParse({ email: email.trim(), password });
    if (!v.success) {
      setError("Correo o contraseña incorrectos");
      return;
    }
    setError(null);
    login.mutate(v.data);
  };

  return (
    <PanelShell subtitle="Iniciar sesión">
      <form className="mt-4 space-y-4" onSubmit={enviar} aria-label="Iniciar sesión">
        <label className="block">
          <span className="font-bold">Correo</span>
          <input
            className={campo}
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="font-bold">Contraseña</span>
          <input
            className={campo}
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={login.isPending}
          className={buttonVariants({ size: "lg" }) + " w-full"}
        >
          Entrar
        </button>
      </form>
    </PanelShell>
  );
}

function CodigoForm(props: {
  onCodigo: (codigo: string) => void;
  pending: boolean;
  error: string | null;
}) {
  const [codigo, setCodigo] = useState("");
  const valido = codigoSchema.safeParse(codigo).success;
  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) props.onCodigo(codigo);
      }}
    >
      <label className="block">
        <span className="font-bold">Código de 6 dígitos</span>
        <input
          className={campo}
          inputMode="numeric"
          name="otp"
          autoComplete="one-time-code"
          maxLength={6}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
      </label>
      {props.error && (
        <p role="alert" className="text-destructive">
          {props.error}
        </p>
      )}
      <button
        type="submit"
        disabled={!valido || props.pending}
        className={buttonVariants({ size: "lg" }) + " w-full"}
      >
        Verificar
      </button>
    </form>
  );
}

export function MfaScreen(props: { onSession: (s: Session) => void; onSignOut: () => void }) {
  const backend = useBackend("panel");
  const factores = useQuery({
    queryKey: ["totp-factors"],
    queryFn: () => backend.listTotpFactors(),
  });
  const verificado = factores.data?.find((f) => f.status === "verified");
  const enrolar = useQuery({
    queryKey: ["totp-enroll"],
    queryFn: () => backend.enrollTotp(),
    enabled: factores.isSuccess && !verificado,
    staleTime: Infinity,
    gcTime: 0,
  });
  const factorId = verificado?.id ?? enrolar.data?.factorId;
  const verificar = useMutation({
    mutationFn: (codigo: string) => {
      if (!factorId) throw new Error("Sin factor TOTP");
      return backend.verifyTotp(factorId, codigo);
    },
    onSuccess: props.onSession,
  });
  const error = verificar.isError ? "Código incorrecto o vencido" : null;

  return (
    <PanelShell subtitle="Verificación en dos pasos">
      {factores.isPending && <p className="mt-4">Cargando…</p>}
      {!verificado && enrolar.data && (
        <div className="mt-4 space-y-2">
          <p>
            Escanee el código QR con su aplicación autenticadora (Google Authenticator, Authy…).
          </p>
          <img
            alt="Código QR para la verificación en dos pasos"
            className="mx-auto h-48 w-48 bg-white"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(enrolar.data.qrCodeSvg)}`}
          />
          <p className="break-all text-sm text-muted-foreground">
            Clave manual: <code>{enrolar.data.secret}</code>
          </p>
        </div>
      )}
      {(verificado || enrolar.data) && (
        <CodigoForm
          onCodigo={(c) => verificar.mutate(c)}
          pending={verificar.isPending}
          error={error}
        />
      )}
      {(factores.isError || enrolar.isError) && (
        <p role="alert" className="mt-4 text-destructive">
          No se pudo preparar la verificación. Intente de nuevo.
        </p>
      )}
      <button
        type="button"
        className={buttonVariants({ variant: "ghost" }) + " mt-6"}
        onClick={props.onSignOut}
      >
        Cerrar sesión
      </button>
    </PanelShell>
  );
}
