import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom no implementa crypto.subtle: se usa el WebCrypto de Node 24 (PBKDF2 del PIN).
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

afterEach(() => {
  cleanup();
});
