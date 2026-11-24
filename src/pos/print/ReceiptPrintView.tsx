/** Recibo para window.print(): oculto en pantalla, visible solo al imprimir (ver `.receipt-80mm` en index.css). */
export function ReceiptPrintView(props: { lines: string[] }) {
  return (
    <div className="hidden print:block">
      <pre className="receipt-80mm">{props.lines.join("\n")}</pre>
    </div>
  );
}
