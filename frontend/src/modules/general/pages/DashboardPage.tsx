import { useState } from "react";
import { useAuth } from "../../../shared/auth/useAuth";
import { GeneralAnalyticsSection } from "../components/GeneralAnalyticsSection";
import { MigaoAnalyticsSection } from "../components/MigaoAnalyticsSection";
import { ConSentidoAnalyticsSection } from "../components/ConSentidoAnalyticsSection";
import { InsumosAnalyticsSection } from "../components/InsumosAnalyticsSection";
import { PedidosAnalyticsSection } from "../components/PedidosAnalyticsSection";
import { ReiniciarTodoModal } from "../components/ReiniciarTodoModal";

type Seccion = "general" | "migao" | "consentido" | "insumos" | "pedidos";

const SECCIONES: { id: Seccion; label: string; icon: string }[] = [
  { id: "general", label: "Resumen General", icon: "📊" },
  { id: "migao", label: "Migao (POS)", icon: "🍽️" },
  { id: "consentido", label: "Con Sentido", icon: "🎨" },
  { id: "insumos", label: "Insumos", icon: "📦" },
  { id: "pedidos", label: "Pedidos", icon: "🚚" },
];

export function DashboardPage() {
  const { usuario } = useAuth();
  const esSuperRoot = usuario?.rol === "Super Root";
  const [modalAbierto, setModalAbierto] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [seccionActual, setSeccionActual] = useState<Seccion>("general");

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

      {/* Steps/Secciones */}
      <div className="flex overflow-x-auto gap-2 pb-4 -mx-6 px-6 sm:mx-0 sm:px-0">
        {SECCIONES.map((seccion) => (
          <button
            key={seccion.id}
            onClick={() => setSeccionActual(seccion.id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 whitespace-nowrap font-medium transition-colors ${
              seccionActual === seccion.id
                ? "bg-brand-green-600 text-white"
                : "bg-brand-green-50 text-brand-green-700 hover:bg-brand-green-100 dark:bg-brand-green-700/30 dark:text-brand-vanilla dark:hover:bg-brand-green-700/50"
            }`}
          >
            <span>{seccion.icon}</span>
            <span>{seccion.label}</span>
          </button>
        ))}
      </div>

      {/* Contenido de la sección actual */}
      <div className="mt-2">
        {seccionActual === "general" && <GeneralAnalyticsSection />}
        {seccionActual === "migao" && <MigaoAnalyticsSection />}
        {seccionActual === "consentido" && <ConSentidoAnalyticsSection />}
        {seccionActual === "insumos" && <InsumosAnalyticsSection />}
        {seccionActual === "pedidos" && <PedidosAnalyticsSection />}
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
