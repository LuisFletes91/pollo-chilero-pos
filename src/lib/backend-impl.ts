import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Aal, Backend, CreateBackendImpl, Session } from "@/lib/backend";
import { env } from "@/lib/env";
import { BackendError } from "@/lib/utils";

/** Convierte cualquier error en BackendError: code = prefijo antes de ":" o "RED". */
export function toBackendError(error: unknown): BackendError {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  const esRed =
    error instanceof TypeError || /failed to fetch|network|fetch failed|load failed/i.test(message);
  if (esRed) return new BackendError("RED", message);
  const m = /^([A-Z][A-Z0-9_]+):/.exec(message);
  return new BackendError(m?.[1] ?? "ERROR", message);
}

async function sessionOf(client: SupabaseClient): Promise<Session | null> {
  const { data, error } = await client.auth.getSession();
  if (error) throw toBackendError(error);
  const s = data.session;
  if (!s) return null;
  const aal = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.error) throw toBackendError(aal.error);
  return {
    userId: s.user.id,
    aal: (aal.data.currentLevel ?? "aal1") as Aal,
    isAnonymous: Boolean(s.user.is_anonymous),
  };
}

async function requireSession(client: SupabaseClient): Promise<Session> {
  const s = await sessionOf(client);
  if (!s) throw new BackendError("NO_AUTORIZADO", "NO_AUTORIZADO: no hay sesión");
  return s;
}

export const createBackendImpl: CreateBackendImpl = (kind) => {
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: kind === "pos" ? "pc-pos-auth" : "pc-panel-auth",
    },
  });

  const backend: Backend = {
    async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
      try {
        const { data, error } = await client.rpc(fn, args ?? {});
        if (error) throw toBackendError(error);
        return data as T;
      } catch (e) {
        throw e instanceof BackendError ? e : toBackendError(e);
      }
    },
    getSession: () => sessionOf(client),
    async signInAnonymously() {
      const { error } = await client.auth.signInAnonymously();
      if (error) throw toBackendError(error);
      return requireSession(client);
    },
    async signInWithPassword(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw toBackendError(error);
      return requireSession(client);
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw toBackendError(error);
    },
    async listTotpFactors() {
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) throw toBackendError(error);
      return data.all
        .filter((f) => f.factor_type === "totp")
        .map((f) => ({ id: f.id, status: f.status === "verified" ? "verified" : "unverified" }));
    },
    async enrollTotp() {
      const { data, error } = await client.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw toBackendError(error);
      return { factorId: data.id, qrCodeSvg: data.totp.qr_code, secret: data.totp.secret };
    },
    async verifyTotp(factorId, code) {
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw toBackendError(error);
      return requireSession(client);
    },
    async uploadReceiptPhoto(path, file) {
      const { data, error } = await client.storage.from("comprobantes").upload(path, file, {
        upsert: false,
      });
      if (error) throw toBackendError(error);
      return data.path;
    },
  };
  return backend;
};
