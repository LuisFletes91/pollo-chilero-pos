import type { ReactNode } from "react";
import combosFamiliares from "@/assets/marca/combos-familiares.webp";
import combosInfantiles from "@/assets/marca/combos-infantiles.webp";
import combosPersonales from "@/assets/marca/combos-personales.webp";
import extras from "@/assets/marca/extras.webp";
import gallo from "@/assets/marca/gallo.webp";
import logo from "@/assets/marca/logo.webp";
import polloPiezas from "@/assets/marca/pollo-piezas.webp";
import bebidas from "@/assets/marca/bebidas.webp";
import { cn } from "@/lib/utils";

// Imágenes recortadas de las fotos del menú del local (provisionales: reemplazar por el arte
// oficial de la franquicia cuando exista, con el mismo nombre de archivo).
export const LOGO_URL = logo;
export const GALLO_URL = gallo;

/** Foto por código de categoría del catálogo (CF, CP, PZ, CI, EX, BE). */
export const FOTO_CATEGORIA: Readonly<Record<string, string>> = {
  CF: combosFamiliares,
  CP: combosPersonales,
  PZ: polloPiezas,
  CI: combosInfantiles,
  EX: extras,
  BE: bebidas,
};

/** Franja roja con el gallo y el nombre, como el marco del menú del local. Decorativa. */
export function MarcaBanda(props: { className?: string; children?: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 border-b-4 border-accent bg-primary px-4 py-2 text-primary-foreground",
        props.className,
      )}
    >
      <img
        src={GALLO_URL}
        alt=""
        width={56}
        height={44}
        className="h-11 w-14 rounded-lg bg-accent object-cover"
      />
      <p className="leading-tight">
        <span className="block text-xl font-bold tracking-wide text-accent">POLLO CHILERO</span>
        <span className="block text-sm font-bold">Orgullo Catracho</span>
      </p>
      {props.children}
    </div>
  );
}

/** Encabezado en píldora amarilla con texto rojo, como los títulos del menú. */
export function PildoraTitulo(props: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        "inline-block rounded-xl bg-accent px-4 py-1 text-xl font-bold uppercase text-primary-strong",
        props.className,
      )}
    >
      {props.children}
    </h2>
  );
}
