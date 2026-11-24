import { cva } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** "L 1,234.50" — sin Intl (el formato no depende del navegador). */
export function formatLempiras(n: number): string {
  const negativo = n < 0;
  const [entero = "0", decimales = "00"] = Math.abs(round2(n)).toFixed(2).split(".");
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negativo ? "-" : ""}L ${miles}.${decimales}`;
}

/** Honduras: UTC-6 fijo, sin horario de verano. */
export function toLocalHN(iso: string | Date): { fecha: string; hora: string } {
  const t = typeof iso === "string" ? new Date(iso) : iso;
  const local = new Date(t.getTime() - 6 * 60 * 60 * 1000).toISOString();
  return { fecha: local.slice(0, 10), hora: local.slice(11, 16) };
}

export class BackendError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg font-bold transition-opacity duration-150 ease-out disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground",
        secondary: "bg-accent text-accent-foreground",
        danger: "bg-destructive text-white",
        ghost: "bg-transparent text-foreground border border-border",
      },
      size: {
        md: "px-4 py-2 text-base",
        lg: "px-6 py-4 text-lg",
        pos: "min-h-18 min-w-18 text-lg font-bold px-3 py-2",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);
