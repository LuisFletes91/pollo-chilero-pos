import { buttonVariants, cn } from "@/lib/utils";

const TECLAS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0"];

/** Aplica una tecla a un monto escrito como texto (máximo 2 decimales). */
export function applyKey(value: string, key: string): string {
  if (key === "borrar") return value.slice(0, -1);
  if (key === ".") return value.includes(".") ? value : (value || "0") + ".";
  const [, dec] = value.split(".");
  if (dec !== undefined && dec.length >= 2) return value;
  if (value === "0") return key;
  return value + key;
}

export function NumPad(props: {
  value: string;
  onChange: (value: string) => void;
  onExact?: () => void;
  label: string;
}) {
  const { value, onChange, onExact, label } = props;
  return (
    <div role="group" aria-label={label} className="grid grid-cols-3 gap-2">
      {TECLAS.map((k) => (
        <button
          key={k}
          type="button"
          className={buttonVariants({ variant: "ghost", size: "pos" })}
          onClick={() => onChange(applyKey(value, k))}
        >
          {k}
        </button>
      ))}
      <button
        type="button"
        aria-label="Borrar"
        className={buttonVariants({ variant: "ghost", size: "pos" })}
        onClick={() => onChange(applyKey(value, "borrar"))}
      >
        ⌫
      </button>
      {onExact && (
        <button
          type="button"
          className={cn(buttonVariants({ variant: "secondary", size: "pos" }), "col-span-3")}
          onClick={onExact}
        >
          Exacto
        </button>
      )}
    </div>
  );
}
