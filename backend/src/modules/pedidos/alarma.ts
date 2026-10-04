import * as notificacionesService from "../general/notificaciones/notificaciones.service";
import * as repo from "./pedidos.repository";

// Mismo patrón que integracion_ecommerce/salida.ts::iniciarEnvioPeriodico:
// un chequeo liviano cada minuto, nunca en paralelo consigo mismo.
const INTERVALO_REVISION_MS = 60 * 1000;

export function iniciarRevisionAlarmasPedidos(): void {
  setInterval(() => void revisarPedidosVencidos().catch((err) => console.error("[alarma pedidos]", err)), INTERVALO_REVISION_MS).unref?.();
}

async function revisarPedidosVencidos() {
  const vencidos = await repo.listPedidosVencidos();
  if (vencidos.length === 0) return;

  const parametros = await repo.getParametros();
  const intervaloMinutos = Number(parametros.intervalo_alarma_minutos);

  for (const pedido of vencidos) {
    const titulo = pedido.estado === "pendiente" ? "Pedido sin alistar" : "Pedido sin enviar";
    const cuerpo = `${pedido.destinatario_nombre ?? pedido.descripcion} lleva esperando — revisa el pedido.`;
    const payload = { titulo, cuerpo, url: `/pedidos/${pedido.id}` };
    await notificacionesService.enviarATodosDeRol("Root", payload);
    await notificacionesService.enviarATodosDeRol("Super Root", payload);
    // Se reprograma siempre, haya o no suscripción push activa — así la
    // ventana emergente del frontend (que no depende del push) también
    // sigue encontrando este pedido como "vencido" en el próximo ciclo.
    await repo.reprogramarAlarma(pedido.id, intervaloMinutos);
  }
}
