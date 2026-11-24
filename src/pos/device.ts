import type { Backend } from "@/lib/backend";
import { db, getMeta, setMeta } from "@/pos/db";

type Snapshot = {
  version: number;
  unchanged: boolean;
  device: { id: string; label: string; last_receipt_number: number; last_client_seq: number };
  categories?: { code: string; name: string; sort_order: number }[];
  products?: {
    id: string;
    code: string;
    name: string;
    category_code: string;
    price: number | string;
    isv_rate: number | string;
    active: boolean;
    sort_order: number;
  }[];
  staff?: {
    id: string;
    display_name: string;
    role: "cajero" | "supervisor";
    pin_salt: string;
    pin_hash: string;
    pin_iterations: number;
  }[];
  settings?: Record<string, unknown>;
};

export async function isPaired(): Promise<boolean> {
  return Boolean(await getMeta<string>("deviceId"));
}

export async function pairDevice(backend: Backend, code: string, label: string): Promise<void> {
  await backend.signInAnonymously();
  const res = await backend.rpc<{ device_id: string; label: string }>("pos_claim_device", {
    p_code: code.trim().toUpperCase(),
    p_label: label,
  });
  await setMeta("deviceId", res.device_id);
  await setMeta("deviceLabel", res.label);
  let persisted: boolean;
  try {
    persisted = Boolean(await navigator.storage?.persist?.());
  } catch {
    persisted = false;
  }
  await setMeta("storagePersisted", persisted);
  await pullSnapshot(backend);
}

export async function pullSnapshot(backend: Backend): Promise<void> {
  const since = (await getMeta<number>("snapshotVersion")) ?? 0;
  const s = await backend.rpc<Snapshot>("pos_pull_snapshot", { p_since: since });
  if (s.unchanged) return;
  await db.transaction(
    "rw",
    [db.meta, db.categories, db.products, db.staff, db.settings],
    async () => {
      await Promise.all([
        db.categories.clear(),
        db.products.clear(),
        db.staff.clear(),
        db.settings.clear(),
      ]);
      await db.categories.bulkPut(
        (s.categories ?? []).map((c) => ({ code: c.code, name: c.name, sortOrder: c.sort_order })),
      );
      await db.products.bulkPut(
        (s.products ?? []).map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          categoryCode: p.category_code,
          price: Number(p.price),
          isvRate: Number(p.isv_rate),
          active: p.active,
          sortOrder: p.sort_order,
        })),
      );
      await db.staff.bulkPut(
        (s.staff ?? []).map((x) => ({
          id: x.id,
          displayName: x.display_name,
          role: x.role,
          pinSalt: x.pin_salt,
          pinHash: x.pin_hash,
          pinIterations: x.pin_iterations,
        })),
      );
      await db.settings.bulkPut(
        Object.entries(s.settings ?? {}).map(([key, value]) => ({ key, value })),
      );
      await setMeta("snapshotVersion", s.version);
      const localReceipt = (await getMeta<number>("lastReceiptNumber")) ?? 0;
      const localSeq = (await getMeta<number>("lastClientSeq")) ?? 0;
      await setMeta("lastReceiptNumber", Math.max(localReceipt, s.device.last_receipt_number));
      await setMeta("lastClientSeq", Math.max(localSeq, s.device.last_client_seq));
    },
  );
}
