import { z } from "zod";
import { referenciaBancoSchema } from "../../shared/utils/pago-mixto";

// Un ítem viene del autocompletar de catálogo (trae productoId) o se escribe
// a mano (sin productoId) — mismo patrón que con_sentido.schema.ts.
const itemPedidoSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre del ítem es obligatorio").max(150),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
  precioUnitario: z.number().nonnegative(),
  productoId: z.string().uuid().optional(),
});

const ESTADOS_DESTINO = ["alistado", "enviado", "entregado", "cancelado"] as const;
export type EstadoPedido = "pendiente" | (typeof ESTADOS_DESTINO)[number];

// transportadora/numeroGuia NO van acá: recién se conocen al despachar, no
// al crear el pedido — se capturan en cambiarEstadoPedidoSchema (al marcar
// "enviado") y se pueden corregir después vía editarPedidoSchema.
const camposEnvio = {
  destinatarioNombre: z.string().trim().max(150).optional(),
  destinatarioDocumento: z.string().trim().max(30).optional(),
  destinatarioTelefono: z.string().trim().max(30).optional(),
  direccionEnvio: z.string().trim().max(250).optional(),
  ciudadEnvio: z.string().trim().max(100).optional(),
  notasEntrega: z.string().trim().optional(),
};

const METODOS_ENVIO = ["transportadora", "recoge_tienda", "plataforma"] as const;
export type MetodoEnvioPedido = (typeof METODOS_ENVIO)[number];

// Cada método de envío trae sus propios campos — cuáles son obligatorios
// (transportadora+numeroGuia, o conductorNombre+conductorPlaca) lo exige el
// service según el metodoEnvio elegido, no acá (recoge_tienda no necesita
// ninguno de estos campos).
const camposTransporte = {
  metodoEnvio: z.enum(METODOS_ENVIO).optional(),
  transportadora: z.string().trim().max(100).optional(),
  numeroGuia: z.string().trim().max(100).optional(),
  conductorNombre: z.string().trim().max(150).optional(),
  conductorPlaca: z.string().trim().max(20).optional(),
  conductorDescripcion: z.string().trim().optional(),
};

export const crearPedidoSchema = z.object({
  clienteId: z.string().uuid().optional(),
  // Si no la escriben, el service la arma sola a partir de los nombres de
  // los ítems (mismo criterio que con_sentido.service.ts para el "motivo").
  descripcion: z.string().trim().max(500).optional(),
  // Ya no se pide "fecha de entrega": en la factura/rótulo se muestra la
  // fecha en que el pedido se marcó "alistado" (ver alistado_en), con la
  // etiqueta "Despacho" en vez de "Entrega".
  responsableId: z.string().uuid().optional(),
  items: z.array(itemPedidoSchema).min(1, "Agrega al menos un ítem al pedido"),
  abonoInicial: z
    .object({
      monto: z.number().positive(),
      metodoPago: z.enum(["efectivo", "banco"]),
      // Obligatoria si metodoPago es "banco" — se valida en el service con
      // exigirReferenciaBanco (regla global: todo pago recibido por banco
      // necesita los últimos 4 del ID de la transferencia).
      ...referenciaBancoSchema,
    })
    .optional(),
  ...camposEnvio,
});
export type CrearPedidoInput = z.infer<typeof crearPedidoSchema>;

// Edición de datos generales — nunca ítems ni estado (eso tiene su propio
// endpoint, con su propia lógica de stock/alarma).
export const editarPedidoSchema = z.object({
  descripcion: z.string().trim().min(1).max(500).optional(),
  responsableId: z.string().uuid().optional(),
  ...camposEnvio,
  ...camposTransporte,
});
export type EditarPedidoInput = z.infer<typeof editarPedidoSchema>;

export const cambiarEstadoPedidoSchema = z.object({
  estado: z.enum(ESTADOS_DESTINO),
  // Obligatoria solo si el producto queda en negativo al alistar — el
  // service la exige puntualmente (mismo criterio que Con Sentido).
  observacionInventario: z.string().trim().optional(),
  // Obligatorios solo al marcar "enviado", y según metodoEnvio (y solo si el
  // pedido no los tenía ya guardados de una edición anterior) — el service
  // los exige puntualmente.
  ...camposTransporte,
});
export type CambiarEstadoPedidoInput = z.infer<typeof cambiarEstadoPedidoSchema>;

export const registrarAbonoPedidoSchema = z.object({
  monto: z.number().positive(),
  metodoPago: z.enum(["efectivo", "banco"]),
  ...referenciaBancoSchema,
});
export type RegistrarAbonoPedidoInput = z.infer<typeof registrarAbonoPedidoSchema>;

export const actualizarParametrosPedidosSchema = z.object({
  intervaloAlarmaMinutos: z.number().int().positive(),
});
export type ActualizarParametrosPedidosInput = z.infer<typeof actualizarParametrosPedidosSchema>;
