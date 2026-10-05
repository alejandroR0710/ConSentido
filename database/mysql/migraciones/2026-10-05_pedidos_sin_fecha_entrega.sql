-- ============================================================================
-- Pedidos — ya no se pide "fecha de entrega" al crear el pedido. En la
-- factura y el rótulo de envío se muestra en su lugar la fecha en que el
-- pedido se marcó "alistado" (alistado_en), con la etiqueta "Despacho".
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- ============================================================================

ALTER TABLE pedidos MODIFY fecha_entrega DATE NULL;
