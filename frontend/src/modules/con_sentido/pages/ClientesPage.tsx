import { useState } from "react";
import { Link } from "react-router-dom";
import { NuevaClienteModal } from "../components/NuevaClienteModal";

export function ClientesPage() {
  const [clientes, setClientes] = useState<any[]>([]);
  const [modalAbierto, setModalAbierto] = useState(false);

  function guardarCliente(cliente: any) {
    setClientes([cliente, ...clientes]);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">
            Clientes
          </h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Gestiona los clientes de Con Sentido
          </p>
        </div>
        <Link
          to="/con-sentido"
          className="rounded-md border border-brand-vanilla-dark px-3 py-2 text-xs font-medium text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
        >
          ← Atrás
        </Link>
      </div>

      <button
        onClick={() => setModalAbierto(true)}
        className="w-full max-w-xs rounded-md bg-brand-green-600 px-4 py-3 font-medium text-white hover:bg-brand-green-700"
      >
        + Nuevo cliente
      </button>

      {clientes.length === 0 ? (
        <div className="rounded-lg border border-brand-vanilla-dark p-8 text-center dark:border-brand-green-700">
          <p className="text-brand-ink/60 dark:text-brand-vanilla/60">
            No hay clientes registrados aún
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">Teléfono</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Compras</th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((cliente) => (
                <tr key={cliente.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                  <td className="px-4 py-2 font-medium">{cliente.nombre}</td>
                  <td className="px-4 py-2">{cliente.telefono || "—"}</td>
                  <td className="px-4 py-2 text-xs">{cliente.email || "—"}</td>
                  <td className="px-4 py-2">{cliente.compras}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalAbierto && (
        <NuevaClienteModal
          onCerrar={() => setModalAbierto(false)}
          onGuardar={guardarCliente}
        />
      )}
    </div>
  );
}
