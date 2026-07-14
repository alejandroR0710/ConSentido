import { useState } from "react";
import { useAuth } from "../../../shared/auth/useAuth";
import { MigaoAnalyticsSection } from "../components/MigaoAnalyticsSection";
import { ReiniciarTodoModal } from "../components/ReiniciarTodoModal";

const MODULOS_SIN_ANALYTICS = [
  { nombre: "Insumos", nota: "Analíticas de inventario/consumo — próximamente." },
  { nombre: "Talleres", nota: "Analíticas de talleres — próximamente." },
  { nombre: "Con Sentido", nota: "Analíticas de ventas — próximamente." },
  { nombre: "Pedidos", nota: "Analíticas de pedidos a domicilio — próximamente." },
];

export function DashboardPage() {
  const { usuario } = useAuth();
  const esSuperRoot = usuario?.rol === "Super Root";
  const [modalAbierto, setModalAbierto] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-2 text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">
          Hola, {usuario?.nombre}
        </h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Módulos disponibles para tu rol: {usuario?.modulos.join(", ") || "ninguno asignado"}.
        </p>
      </div>

      {mensaje && <p className="text-sm text-brand-green-700 dark:text-brand-vanilla">{mensaje}</p>}

      <MigaoAnalyticsSection />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {MODULOS_SIN_ANALYTICS.map((m) => (
          <div
            key={m.nombre}
            className="rounded-lg border border-dashed border-brand-vanilla-dark p-4 text-sm text-brand-ink/60 dark:border-brand-green-700 dark:text-brand-vanilla/60"
          >
            <span className="font-medium text-brand-ink dark:text-brand-vanilla">{m.nombre}</span> — {m.nota}
          </div>
        ))}
      </div>

      {esSuperRoot && (
        <div className="max-w-lg rounded-lg border-2 border-dashed border-red-300 p-4 dark:border-red-800">
          <h2 className="mb-1 font-medium text-red-600">Zona de Super Root</h2>
          <p className="mb-3 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            Borra por completo el historial de órdenes, ventas, pagos, turnos y movimientos de caja de cualquier
            módulo — deja el negocio como recién instalado. Conserva menú, usuarios y roles. Para reinicios más
            puntuales, sigue existiendo "Reiniciar Caja" (en Caja General) y "Reiniciar historial de órdenes" (en
            Migao POS).
          </p>
          <button
            onClick={() => setModalAbierto(true)}
            className="w-full max-w-xs rounded-md border-2 border-red-600 px-4 py-2 font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            Reiniciar todo
          </button>
        </div>
      )}

      {modalAbierto && (
        <ReiniciarTodoModal
          onCerrar={() => setModalAbierto(false)}
          onReiniciado={(msg) => setMensaje(msg)}
        />
      )}
    </div>
  );
}
