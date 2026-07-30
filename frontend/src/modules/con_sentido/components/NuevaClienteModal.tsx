import { useState } from "react";
import { Modal } from "../../../shared/components/Modal";

interface NuevaClienteModalProps {
  onCerrar: () => void;
  onGuardar: (cliente: any) => void;
}

export function NuevaClienteModal({ onCerrar, onGuardar }: NuevaClienteModalProps) {
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");

  function guardar() {
    if (!nombre.trim()) return;

    const cliente = {
      id: Date.now(),
      nombre: nombre.trim(),
      telefono,
      email,
      compras: 0,
      fecha_creacion: new Date().toISOString(),
    };

    onGuardar(cliente);
    setNombre("");
    setTelefono("");
    setEmail("");
    onCerrar();
  }

  return (
    <Modal titulo="Nuevo cliente" onCerrar={onCerrar}>
      <label className="mb-1 block text-xs font-medium">Nombre</label>
      <input
        autoFocus
        type="text"
        placeholder="Nombre del cliente"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Teléfono (opcional)</label>
      <input
        type="tel"
        placeholder="Número de teléfono"
        value={telefono}
        onChange={(e) => setTelefono(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Email (opcional)</label>
      <input
        type="email"
        placeholder="Correo electrónico"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <button
        onClick={guardar}
        disabled={!nombre.trim()}
        className="w-full rounded-md bg-brand-green-600 px-4 py-3 font-semibold text-white hover:bg-brand-green-700 disabled:opacity-60"
      >
        Guardar cliente
      </button>
    </Modal>
  );
}
