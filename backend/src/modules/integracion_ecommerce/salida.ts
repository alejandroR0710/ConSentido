import { randomUUID } from "crypto";
import { Pool, PoolClient, pool } from "../../shared/db/pool";
import { configSincronizacion, sincronizacionActiva } from "./config";
import type { DeltaStockPos } from "./tipos";

type Executor = Pool | PoolClient;

const INTERVALO_MS = 60 * 1000;
const TANDA = 50;
const TIMEOUT_MS = 10 * 1000;
// Tras tantos intentos el aviso queda 'fallido' y deja de bloquear a los
// siguientes (con la espera creciente de abajo son unas 10 horas).
const MAX_INTENTOS = 15;
const MAX_ESPERA_MS = 60 * 60 * 1000;
// El aviso se escribe DENTRO de la transacción de la venta: se espera un poco
// para que esa transacción confirme antes de intentar enviarlo.
const RETRASO_ENVIO_MS = 1500;

export function esperaReintento(intentos: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, intentos - 1), MAX_ESPERA_MS);
}

/**
 * Encola un aviso de stock para el e-commerce, en la transacción del llamador
 * (`executor` = el client de la venta): si la venta se revierte, el aviso
 * también. Sin la sincronización configurada no hace nada.
 */
export async function encolarDeltaStock(executor: Executor, delta: DeltaStockPos): Promise<void> {
  if (!sincronizacionActiva() || delta.delta === 0) return;
  await executor.query(
    `INSERT INTO ecommerce_sync_salida (event_id, tipo, payload) VALUES ($1, 'STOCK_DELTA', $2)`,
    [randomUUID(), delta],
  );
}

let temporizador: NodeJS.Timeout | undefined;
let retraso: NodeJS.Timeout | undefined;
let enCurso: Promise<number> | null = null;

/** Programa un envío en breve (varias ventas seguidas se juntan en uno). */
export function programarEnvio(): void {
  if (!sincronizacionActiva()) return;
  if (retraso) clearTimeout(retraso);
  retraso = setTimeout(() => void enviarSeguro(), RETRASO_ENVIO_MS);
  retraso.unref?.();
}

/** Envío periódico mientras el proceso esté vivo (ver server.ts). */
export function iniciarEnvioPeriodico(): void {
  if (temporizador) return;
  temporizador = setInterval(() => void enviarSeguro(), INTERVALO_MS);
  temporizador.unref?.();
}

async function enviarSeguro() {
  try {
    await enviarPendientes();
  } catch (err) {
    console.error("[sync e-commerce] falló el envío de avisos", err);
  }
}

/**
 * Entrega los avisos pendientes en orden (`seq`). Si uno falla se corta la
 * tanda: el e-commerce nunca recibe un aviso antes que uno anterior. Si ya hay
 * una tanda corriendo, se espera esa (dos en paralelo podrían desordenarse).
 * Devuelve cuántos se entregaron.
 */
export function enviarPendientes(): Promise<number> {
  if (!enCurso) {
    enCurso = enviarUnaVez().finally(() => {
      enCurso = null;
    });
  }
  return enCurso;
}

async function enviarUnaVez(): Promise<number> {
  const config = configSincronizacion();
  if (!config) return 0;

  let entregados = 0;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT seq, event_id, tipo, payload, intentos, proximo_intento, created_at
         FROM ecommerce_sync_salida
        WHERE estado = 'pendiente'
        ORDER BY seq ASC
        LIMIT ${TANDA}`,
    );
    if (rows.length === 0) return entregados;

    for (const aviso of rows) {
      if (new Date(aviso.proximo_intento).getTime() > Date.now()) return entregados;

      const error = await enviar(config, aviso);
      if (!error) {
        await pool.query(
          `UPDATE ecommerce_sync_salida SET estado = 'enviado', enviado_at = now(), ultimo_error = NULL WHERE seq = $1`,
          [aviso.seq],
        );
        entregados++;
        continue;
      }

      const intentos = Number(aviso.intentos) + 1;
      const rendirse = intentos >= MAX_INTENTOS;
      await pool.query(
        `UPDATE ecommerce_sync_salida
            SET intentos = $2, ultimo_error = $3, estado = $4, proximo_intento = $5
          WHERE seq = $1`,
        [aviso.seq, intentos, error.slice(0, 2000), rendirse ? "fallido" : "pendiente", new Date(Date.now() + esperaReintento(intentos))],
      );
      console.warn(`[sync e-commerce] aviso ${aviso.event_id} no entregado (intento ${intentos}): ${error}`);
      if (!rendirse) return entregados;
    }
  }
}

/** null = entregado; texto = motivo del fallo. */
async function enviar(
  config: { url: string; clave: string },
  aviso: { event_id: string; tipo: string; payload: unknown },
): Promise<string | null> {
  const payload = typeof aviso.payload === "string" ? JSON.parse(aviso.payload) : aviso.payload;
  try {
    const respuesta = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-key": config.clave },
      body: JSON.stringify({ eventId: aviso.event_id, type: aviso.tipo, payload }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (respuesta.ok) return null;
    const cuerpo = await respuesta.text().catch(() => "");
    return `HTTP ${respuesta.status} ${cuerpo.slice(0, 500)}`.trim();
  } catch (err) {
    return (err as Error).message || String(err);
  }
}

/** Resumen para diagnóstico (GET /api/integraciones/ecommerce/estado). */
export async function estadoSalida() {
  const { rows } = await pool.query(
    `SELECT estado, COUNT(*) AS total, MIN(created_at) AS mas_antiguo
       FROM ecommerce_sync_salida
      GROUP BY estado`,
  );
  const ultimoError = await pool.query(
    `SELECT ultimo_error FROM ecommerce_sync_salida
      WHERE estado <> 'enviado' AND ultimo_error IS NOT NULL
      ORDER BY seq DESC LIMIT 1`,
  );
  return {
    activa: sincronizacionActiva(),
    porEstado: rows,
    ultimoError: ultimoError.rows[0]?.ultimo_error ?? null,
  };
}
