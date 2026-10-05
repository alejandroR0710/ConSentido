-- ============================================================================
-- Pedidos — método de envío al marcar "enviado": transportadora (con guía),
-- recoge en tienda, o plataforma de recogida (conductor + placa + nota
-- opcional). Antes solo existía la opción de transportadora.
--
-- Correr UNA vez en phpMyAdmin (base de datos del sistema → pestaña SQL).
-- ============================================================================

ALTER TABLE pedidos
  ADD COLUMN metodo_envio          VARCHAR(20) NULL
                                    CHECK (metodo_envio IN ('transportadora','recoge_tienda','plataforma'))
                                    AFTER numero_guia,
  ADD COLUMN conductor_nombre      VARCHAR(150) NULL AFTER metodo_envio,
  ADD COLUMN conductor_placa       VARCHAR(20)  NULL AFTER conductor_nombre,
  ADD COLUMN conductor_descripcion TEXT NULL AFTER conductor_placa;
