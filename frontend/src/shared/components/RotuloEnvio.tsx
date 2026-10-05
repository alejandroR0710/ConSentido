export interface RotuloEnvioProps {
  // Solo la copia que de verdad se imprime lleva "rotulo-imprimible" (ver
  // ModalImprimirRotulo.tsx) — la vista previa no lo lleva, para no tener
  // dos elementos con el mismo id en el DOM al mismo tiempo.
  id?: string;
  destinatarioNombre: string | null;
  destinatarioDocumento: string | null;
  destinatarioTelefono: string | null;
  direccionEnvio: string | null;
  ciudadEnvio: string | null;
  descripcion: string;
  // Fecha en que el pedido se marcó "alistado" — se muestra como "Despacho"
  // (ya no se captura una "fecha de entrega" al crear el pedido).
  fechaAlistado: string | null;
  metodoEnvio: string | null;
  transportadora: string | null;
  numeroGuia: string | null;
  anchoMm: 58 | 80;
  largoMm: number;
}

function formatearFechaCorta(fechaIso: string) {
  return new Date(fechaIso).toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Contenido del rótulo de envío — pensado como una etiqueta ancha y corta
 * (al revés del recibo, que es angosto y largo): se autora en su
 * orientación FINAL (la que se lee ya pegada en la caja). ModalImprimirRotulo
 * es quien se encarga de rotarlo 90° para que salga así en la impresora
 * térmica angosta.
 */
export function RotuloEnvio({
  id,
  destinatarioNombre,
  destinatarioDocumento,
  destinatarioTelefono,
  direccionEnvio,
  ciudadEnvio,
  descripcion,
  fechaAlistado,
  metodoEnvio,
  transportadora,
  numeroGuia,
  anchoMm,
  largoMm,
}: RotuloEnvioProps) {
  return (
    <div
      id={id}
      className="mx-auto flex flex-col items-center justify-center gap-1 bg-white px-3 py-2 text-center text-black"
      // Misma razón que ReciboImprimible: la térmica no tiene grises, un
      // trazo fino se ve punteado — semibold + fuente de trazo parejo
      // imprime sólido.
      style={{
        width: `${largoMm}mm`,
        height: `${anchoMm}mm`,
        fontFamily: '"Consolas", "Courier New", monospace',
        fontWeight: 600,
        WebkitFontSmoothing: "none",
        textRendering: "optimizeLegibility",
      }}
    >
      <p className="text-[10px] uppercase tracking-wide">Con Sentido — El Rinconcito del Migao</p>
      <div className="w-full border-t-2 border-black" />
      <p className="text-[9px] uppercase">Para</p>
      <p className="text-[26px] font-bold leading-tight">{destinatarioNombre ?? "Sin destinatario"}</p>
      {destinatarioDocumento && <p className="text-[14px]">Doc: {destinatarioDocumento}</p>}
      {(direccionEnvio || ciudadEnvio) && (
        <p className="text-[15px] leading-tight">
          {direccionEnvio}
          {direccionEnvio && ciudadEnvio ? ", " : ""}
          {ciudadEnvio}
        </p>
      )}
      {destinatarioTelefono && <p className="text-[15px]">Tel: {destinatarioTelefono}</p>}
      <div className="w-full border-t border-dashed border-black" />
      <p className="text-[13px]">{descripcion}</p>
      {metodoEnvio === "transportadora" && transportadora && (
        <p className="text-[13px] font-bold">
          {transportadora} — Guía: {numeroGuia ?? "—"}
        </p>
      )}
      {fechaAlistado && <p className="text-[12px]">Despacho: {formatearFechaCorta(fechaAlistado)}</p>}
    </div>
  );
}
