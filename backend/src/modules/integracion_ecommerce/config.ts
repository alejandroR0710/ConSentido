// Sincronización de inventario con el e-commerce (consentidovelas.com). Solo
// corre si las dos variables están configuradas; sin ellas no se encola ni se
// acepta ningún aviso.
//   ECOMMERCE_SYNC_URL  endpoint del e-commerce que recibe los avisos del POS
//                       (https://api.consentidovelas.com/api/integrations/pos/events)
//   ECOMMERCE_SYNC_KEY  secreto compartido (el MISMO POS_SYNC_KEY del e-commerce),
//                       en el header x-sync-key en ambas direcciones.
export function configSincronizacion(): { url: string; clave: string } | null {
  const url = process.env.ECOMMERCE_SYNC_URL?.trim();
  const clave = process.env.ECOMMERCE_SYNC_KEY?.trim();
  return url && clave ? { url, clave } : null;
}

export function sincronizacionActiva(): boolean {
  return configSincronizacion() !== null;
}
