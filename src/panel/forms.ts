import { z } from "zod";

/** Motivo obligatorio para rechazos (mismo mínimo que la caja). */
export const motivoSchema = z.string().trim().min(5, "Escriba el motivo (5 o más caracteres)");
