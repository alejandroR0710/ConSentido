import { useState } from "react";
import { Navigate } from "react-router-dom";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { useAuth } from "../../../shared/auth/useAuth";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { CalculadoraTab } from "../components/CalculadoraTab";
import { MaterialesTab } from "../components/MaterialesTab";

/** Calculadora de costos de velas — exclusiva de Root/Super Root. Arma una
 *  receta (ceras/fragancias/pabilo/empaque) y muestra el costo real y un
 *  precio de venta sugerido; las tablas de precios que usa viven en la
 *  pestaña "Materiales", editables sin tocar código. */
export function CalculadoraVelasPage() {
  const { usuario } = useAuth();
  const puedeVer = tieneAccesoTotal(usuario?.rol);
  const [tab, setTab] = useState<"calculadora" | "materiales">("calculadora");

  if (!puedeVer) {
    return <Navigate to="/con-sentido" replace />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/con-sentido" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Costos de Velas</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Estima el costo real de una vela y un precio de venta sugerido a partir de las tablas de precios.
        </p>
      </div>

      <div className="flex gap-2 border-b-2 border-brand-vanilla-dark dark:border-brand-green-700">
        <button
          onClick={() => setTab("calculadora")}
          className={`px-4 py-2 text-sm font-semibold ${
            tab === "calculadora"
              ? "border-b-2 border-brand-green-700 text-brand-green-700 dark:text-brand-vanilla"
              : "text-brand-ink/60 dark:text-brand-vanilla/60"
          }`}
        >
          Calculadora
        </button>
        <button
          onClick={() => setTab("materiales")}
          className={`px-4 py-2 text-sm font-semibold ${
            tab === "materiales"
              ? "border-b-2 border-brand-green-700 text-brand-green-700 dark:text-brand-vanilla"
              : "text-brand-ink/60 dark:text-brand-vanilla/60"
          }`}
        >
          Materiales
        </button>
      </div>

      {tab === "calculadora" ? <CalculadoraTab /> : <MaterialesTab />}
    </div>
  );
}
