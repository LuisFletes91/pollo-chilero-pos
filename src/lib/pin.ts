// PIN de 4 dígitos: PBKDF2-SHA256 (WebCrypto), 256 bits, sal de 16 bytes. Nunca se guarda ni se envía en claro.
// Vive en src/lib/ porque el panel también crea PIN; la tabla de intentos llega por parámetro.

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function hashPin(pin: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations },
    key,
    256,
  );
  return toHex(bits);
}

export function newSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export type PinStaff = { pinSalt: string; pinHash: string; pinIterations: number };

export async function verifyPin(pin: string, staff: PinStaff): Promise<boolean> {
  const h = await hashPin(pin, staff.pinSalt, staff.pinIterations);
  // Comparación de longitud fija.
  let diff = h.length ^ staff.pinHash.length;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ (staff.pinHash.charCodeAt(i) || 0);
  return diff === 0;
}

// ---------- bloqueo por intentos fallidos ----------
export type PinAttempt = { staffId: string; failures: number; lockedUntil?: number };
export interface PinAttemptsTable {
  get(staffId: string): PromiseLike<PinAttempt | undefined>;
  put(row: PinAttempt): PromiseLike<unknown>;
  delete(staffId: string): PromiseLike<unknown>;
}
export type LockoutPolicy = { intentos: number; segundos: number };
export const DEFAULT_LOCKOUT: LockoutPolicy = { intentos: 5, segundos: 30 };

/** Registra un fallo; devuelve true si con este fallo queda bloqueado. */
export async function registerFailure(
  table: PinAttemptsTable,
  staffId: string,
  policy: LockoutPolicy = DEFAULT_LOCKOUT,
  now: number = Date.now(),
): Promise<boolean> {
  const row = (await table.get(staffId)) ?? { staffId, failures: 0 };
  const failures = row.failures + 1;
  if (failures >= policy.intentos) {
    await table.put({ staffId, failures: 0, lockedUntil: now + policy.segundos * 1000 });
    return true;
  }
  await table.put({ staffId, failures, lockedUntil: row.lockedUntil });
  return false;
}

export async function clearFailures(table: PinAttemptsTable, staffId: string): Promise<void> {
  await table.delete(staffId);
}

/** Epoch ms hasta el que está bloqueado, o null. */
export async function lockedUntil(
  table: PinAttemptsTable,
  staffId: string,
  now: number = Date.now(),
): Promise<number | null> {
  const row = await table.get(staffId);
  return row?.lockedUntil && row.lockedUntil > now ? row.lockedUntil : null;
}
