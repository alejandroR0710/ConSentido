const ESTILOS: Record<string, string> = {
  listo: "bg-brand-green-600 text-brand-vanilla",
  preparando: "bg-amber-500 text-white",
  cancelado: "bg-red-100 text-red-700",
  servido: "bg-brand-vanilla-dark text-brand-ink",
  pendiente: "bg-brand-green-50 text-brand-green-700",
};

/** Badge de color consistente para el estado de un ítem, usado en Mesero, Cocina y cobro. */
export function EstadoBadge({ estado }: { estado: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTILOS[estado] ?? ESTILOS.pendiente}`}>
      {estado}
    </span>
  );
}
