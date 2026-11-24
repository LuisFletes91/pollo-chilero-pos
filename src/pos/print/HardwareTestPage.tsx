import { useEffect, useState } from "react";
import { buildTestTicket, testTicketLines } from "@/pos/print/escpos";
import {
  getRememberedPort,
  isWebSerialSupported,
  requestPrinterPort,
  writeBytes,
  type SerialPortLike,
} from "@/pos/print/serial";

const BAUDIOS = [9600, 19200, 38400, 115200] as const;

export function HardwareTestPage() {
  const soportado = isWebSerialSupported();
  const [baudios, setBaudios] = useState<number>(9600);
  const [puerto, setPuerto] = useState<SerialPortLike | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);

  useEffect(() => {
    if (!soportado) return;
    let activo = true;
    getRememberedPort()
      .then((p) => {
        if (activo) setPuerto(p);
      })
      .catch(() => {});
    return () => {
      activo = false;
    };
  }, [soportado]);

  async function emparejar() {
    setError(null);
    try {
      setPuerto(await requestPrinterPort());
      setMensaje("Impresora emparejada");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function imprimirSerial() {
    if (!puerto) return;
    setError(null);
    try {
      await writeBytes(puerto, buildTestTicket(), baudios);
      setMensaje("Ticket enviado a la impresora");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function imprimirNavegador() {
    setError(null);
    setTicket(testTicketLines().join("\n"));
    // Espera al render del ticket antes de abrir el diálogo de impresión.
    setTimeout(() => window.print(), 0);
  }

  const boton = "rounded-lg px-6 py-4 text-lg font-bold disabled:opacity-50";

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <h1 className="text-3xl font-bold text-primary">Caja — Prueba de impresora</h1>
      <p className="mt-2 text-muted-foreground">
        Web Serial: {soportado ? "disponible" : "no disponible en este navegador"}
      </p>
      <label className="mt-4 flex items-center gap-2">
        Baudios
        <select
          className="rounded-lg border border-border bg-surface p-2"
          value={baudios}
          onChange={(e) => setBaudios(Number(e.target.value))}
        >
          {BAUDIOS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className={`${boton} bg-primary text-primary-foreground`}
          disabled={!soportado}
          onClick={emparejar}
        >
          Emparejar impresora (Web Serial)
        </button>
        <button
          type="button"
          className={`${boton} bg-primary text-primary-foreground`}
          disabled={!soportado || !puerto}
          onClick={imprimirSerial}
        >
          Imprimir ticket de prueba
        </button>
        <button
          type="button"
          className={`${boton} bg-accent text-accent-foreground`}
          onClick={imprimirNavegador}
        >
          Imprimir con el navegador (respaldo)
        </button>
      </div>
      {mensaje && <p className="mt-4 text-success">{mensaje}</p>}
      {error && (
        <p role="alert" className="mt-4 font-bold text-destructive">
          {error}
        </p>
      )}
      {ticket && <pre className="receipt-80mm mt-6 bg-surface p-4">{ticket}</pre>}
    </main>
  );
}
