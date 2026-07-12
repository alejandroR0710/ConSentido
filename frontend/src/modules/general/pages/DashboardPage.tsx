import { useAuth } from "../../../shared/auth/useAuth";

export function DashboardPage() {
  const { usuario } = useAuth();
  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">
        Hola, {usuario?.nombre}
      </h1>
      <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
        Módulos disponibles para tu rol: {usuario?.modulos.join(", ") || "ninguno asignado"}.
      </p>
    </div>
  );
}
