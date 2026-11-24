import { z } from "zod";

/** Motivo obligatorio para rechazos (mismo mínimo que la caja). */
export const motivoSchema = z.string().trim().min(5, "Escriba el motivo (5 o más caracteres)");

/** Texto de formulario → número; vacío → undefined. */
const num = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : Number(v));

export const PIEZAS = ["ALA", "PIERNA", "MUSLO", "PECHUGA"] as const;
export type Pieza = (typeof PIEZAS)[number];

export const purchaseSchema = z
  .object({
    itemCode: z.string().min(1, "Elija el ítem"),
    qty: z.preprocess(
      num,
      z.number("Indique la cantidad").positive("La cantidad debe ser mayor que 0"),
    ),
    totalCost: z.preprocess(
      num,
      z.number("Indique el costo total").positive("El costo total debe ser mayor que 0"),
    ),
    supplier: z.string().trim().min(1, "Indique el proveedor"),
    pounds: z.preprocess(num, z.number().positive("Las libras deben ser mayores que 0").optional()),
  })
  .superRefine((v, ctx) => {
    if (v.itemCode === "POLLO-ENTERO" && v.pounds === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["pounds"],
        message: "Las libras son obligatorias para pollo entero",
      });
    }
  });

const entero0 = z.preprocess(
  num,
  z.number("Cantidad inválida").int().min(0, "No puede ser negativo"),
);

export const cutSchema = z.object({
  chickens: z.preprocess(
    num,
    z.number("Indique los pollos").int().min(1, "Corte al menos 1 pollo"),
  ),
  pieces: z.object({ ALA: entero0, PIERNA: entero0, MUSLO: entero0, PECHUGA: entero0 }),
});

export const recipeSchema = z.object({
  productCode: z.string().min(1, "Elija el producto"),
  lines: z
    .array(z.object({ itemCode: z.string(), qty: z.preprocess(num, z.number().optional()) }))
    .transform((ls) =>
      ls
        .filter((l) => l.itemCode !== "" && (l.qty ?? 0) > 0)
        .map((l) => ({ item_code: l.itemCode, qty: l.qty as number })),
    )
    .pipe(
      z
        .array(z.object({ item_code: z.string(), qty: z.number() }))
        .min(1, "La receta necesita al menos una línea"),
    ),
});

export const staffSchema = z.object({
  id: z.string().optional(),
  displayName: z.string().trim().min(2, "Escriba el nombre"),
  role: z.enum(["cajero", "supervisor", "socio"]),
  active: z.boolean(),
  pin: z
    .string()
    .regex(/^(\d{4})?$/, "El PIN debe tener 4 dígitos")
    .transform((p) => (p === "" ? undefined : p)),
});

export const productSchema = z.object({
  code: z.string().optional(),
  categoryCode: z.string().min(1, "Elija la categoría"),
  name: z.string().trim().min(2, "Escriba el nombre"),
  price: z.preprocess(
    num,
    z.number("Indique el precio").positive("El precio debe ser mayor que 0"),
  ),
  active: z.boolean(),
  isvRate: z.union([z.literal(0), z.literal(0.15), z.literal(0.18)]),
});

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora HH:MM");

export const settingSchema = z.discriminatedUnion("key", [
  z.object({
    key: z.literal("cash_diff_threshold"),
    value: z.preprocess(num, z.number("Indique el monto").min(0)),
  }),
  z.object({
    key: z.literal("waste_threshold_pieces"),
    value: z.preprocess(num, z.number("Indique las piezas").int().min(0)),
  }),
  z.object({ key: z.literal("business_hours"), value: z.object({ abre: hora, cierra: hora }) }),
]);

/** Primer mensaje de error de un safeParse fallido. */
export function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Datos inválidos";
}
