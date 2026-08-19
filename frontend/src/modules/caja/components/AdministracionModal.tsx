import { CategoriasPanel } from "./CategoriasPanel";
import { ProveedoresPanel } from "./ProveedoresPanel";

interface AdministracionModalProps {
  onCerrar: () => void;
  onActualizar: () => void;
}

export function AdministracionModal({ onCerrar, onActualizar }: AdministracionModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col rounded-lg bg-white shadow-lg dark:bg-brand-green-900 sm:max-w-2xl lg:max-w-5xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-brand-vanilla-dark p-4 dark:border-brand-green-700">
          <h2 className="text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">Administración</h2>
          <button
            onClick={onCerrar}
            className="text-brand-ink/60 hover:text-brand-ink dark:text-brand-vanilla/60 dark:hover:text-brand-vanilla"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:grid lg:grid-cols-2 lg:gap-6">
          {/* En desktop, las dos columnas. En mobile, una debajo de la otra */}
          <div className="mb-6 lg:mb-0">
            <CategoriasPanel onActualizar={onActualizar} />
          </div>
          <div>
            <ProveedoresPanel onActualizar={onActualizar} />
          </div>
        </div>

        {/* Footer con botón cerrar */}
        <div className="shrink-0 border-t border-brand-vanilla-dark p-4 dark:border-brand-green-700">
          <button
            onClick={onCerrar}
            className="w-full rounded-md bg-brand-green-600 px-4 py-2 font-medium text-white hover:bg-brand-green-700"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
