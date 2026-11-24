import { z } from "zod";

// Única fuente de variables de entorno. Ningún otro archivo lee import.meta.env.
const envSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const name = String(result.error.issues[0]?.path[0] ?? "desconocida");
    throw new Error(`Variable de entorno inválida: ${name}`);
  }
  return result.data;
}

export const env = parseEnv(import.meta.env as Record<string, unknown>);
