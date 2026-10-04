import { apiFetch } from "../../shared/api/client";

export type EstadoPedido = "pendiente" | "alistado" | "enviado" | "entregado" | "cancelado";

export interface ItemPedidoInput {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  productoId?: string;
}

export interface ItemPedido {
  id: number;
  pedido_id: string;
  producto_id: string | null;
  sku: string | null;
  nombre: string;
  cantidad: string;
  precio_unitario: string;
  subtotal: string;
}

export interface AbonoPedido {
  id: string;
  monto: string;
  metodo_pago: "efectivo" | "banco";
  created_at: string;
  usuario_nombre: string | null;
}

export interface HistorialPedido {
  id: number;
  accion: string;
  detalle: Record<string, unknown> | null;
  created_at: string;
  usuario_nombre: string | null;
}

export interface Pedido {
  id: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  descripcion: string;
  fecha_entrega: string;
  destinatario_nombre: string | null;
  destinatario_documento: string | null;
  destinatario_telefono: string | null;
  direccion_envio: string | null;
  ciudad_envio: string | null;
  transportadora: string | null;
  numero_guia: string | null;
  notas_entrega: string | null;
  costo_estimado: string;
  precio_acordado: string;
  estado: EstadoPedido;
  responsable_id: string | null;
  responsable_nombre: string | null;
  creado_por_nombre: string | null;
  alistado_en: string | null;
  enviado_en: string | null;
  entregado_en: string | null;
  proxima_alarma_en: string | null;
  created_at: string;
}

export interface PedidoDetalle extends Pedido {
  items: ItemPedido[];
  abonos: AbonoPedido[];
  historial: HistorialPedido[];
  totalAbonado: number;
  saldoPendiente: number;
}

export interface ParametrosPedidos {
  intervalo_alarma_minutos: number;
}

export interface CrearPedidoInput {
  clienteId?: string;
  descripcion?: string;
  fechaEntrega: string;
  destinatarioNombre?: string;
  destinatarioDocumento?: string;
  destinatarioTelefono?: string;
  direccionEnvio?: string;
  ciudadEnvio?: string;
  transportadora?: string;
  numeroGuia?: string;
  notasEntrega?: string;
  responsableId?: string;
  items: ItemPedidoInput[];
  abonoInicial?: { monto: number; metodoPago: "efectivo" | "banco"; referenciaBanco?: string };
}

export interface RegistrarAbonoInput {
  monto: number;
  metodoPago: "efectivo" | "banco";
  // Obligatoria si metodoPago es "banco" — últimos 4 del ID de la
  // transferencia (regla global, ver SelectorMetodoPago.tsx).
  referenciaBanco?: string;
}

export const pedidosApi = {
  listar: (filtros?: { estado?: EstadoPedido; vencidos?: boolean }) => {
    const params = new URLSearchParams();
    if (filtros?.estado) params.set("estado", filtros.estado);
    if (filtros?.vencidos) params.set("vencidos", "true");
    const qs = params.toString();
    return apiFetch<Pedido[]>(`/pedidos${qs ? `?${qs}` : ""}`);
  },
  obtener: (id: string) => apiFetch<PedidoDetalle>(`/pedidos/${id}`),
  crear: (input: CrearPedidoInput) => apiFetch<PedidoDetalle>("/pedidos", { method: "POST", body: input }),
  editar: (id: string, input: Partial<Omit<CrearPedidoInput, "items" | "abonoInicial">>) =>
    apiFetch<PedidoDetalle>(`/pedidos/${id}`, { method: "PATCH", body: input }),
  cambiarEstado: (id: string, estado: Exclude<EstadoPedido, "pendiente">, observacionInventario?: string) =>
    apiFetch<PedidoDetalle>(`/pedidos/${id}/estado`, { method: "POST", body: { estado, observacionInventario } }),
  registrarAbono: (id: string, input: RegistrarAbonoInput) =>
    apiFetch<PedidoDetalle>(`/pedidos/${id}/abonos`, { method: "POST", body: input }),
  obtenerParametros: () => apiFetch<ParametrosPedidos>("/pedidos/parametros"),
  actualizarParametros: (intervaloAlarmaMinutos: number) =>
    apiFetch<ParametrosPedidos>("/pedidos/parametros", { method: "PUT", body: { intervaloAlarmaMinutos } }),
};
