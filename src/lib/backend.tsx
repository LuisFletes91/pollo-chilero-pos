import { QueryClient } from "@tanstack/react-query";
import { createBackendImpl } from "@/lib/backend-impl";
import { BackendError } from "@/lib/utils";

export { BackendError };

export type Aal = "aal1" | "aal2";
export type Session = { userId: string; aal: Aal; isAnonymous: boolean };
export type TotpFactor = { id: string; status: "verified" | "unverified" };
export type TotpEnrollment = { factorId: string; qrCodeSvg: string; secret: string };

export interface Backend {
  rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T>;
  getSession(): Promise<Session | null>;
  signInAnonymously(): Promise<Session>;
  signInWithPassword(email: string, password: string): Promise<Session>;
  signOut(): Promise<void>;
  listTotpFactors(): Promise<TotpFactor[]>;
  enrollTotp(): Promise<TotpEnrollment>;
  verifyTotp(factorId: string, code: string): Promise<Session>;
  uploadReceiptPhoto(path: string, file: Blob): Promise<string>;
}

export type BackendKind = "pos" | "panel";
export type CreateBackendImpl = (kind: BackendKind) => Backend;

const cache = new Map<BackendKind, Backend>();

export function getBackend(kind: BackendKind): Backend {
  let b = cache.get(kind);
  if (!b) {
    b = createBackendImpl(kind);
    cache.set(kind, b);
  }
  return b;
}

/** Hook de conveniencia: el backend es un singleton, no un contexto React. */
export function useBackend(kind: BackendKind): Backend {
  return getBackend(kind);
}

/** Solo para pruebas. */
export function resetBackendForTests(): void {
  cache.clear();
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});
