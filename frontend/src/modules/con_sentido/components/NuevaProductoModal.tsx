import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";

const CATEGORIAS_CONSENTIDO = [
  { nombre: "Decorativo", logo: "🎨" },
  { nombre: "Bucket", logo: "🪣" },
  { nombre: "Aromático", logo: "🌸" },
  { nombre: "Concreto", logo: "🏗️" },
];

interface NuevaProductoModalProps {
  onCerrar: () => void;
  onGuardar: (producto: any) => Promise<void>;
}

export function NuevaProductoModal({ onCerrar, onGuardar }: NuevaProductoModalProps) {
  const [nombre, setNombre] = useState("");
  const [stock, setStock] = useState(0);
  const [precio, setPrecio] = useState(0);
  const [descripcion, setDescripcion] = useState("");
  const [categoria, setCategoria] = useState(CATEGORIAS_CONSENTIDO[0].nombre);
  const [imagen, setImagen] = useState<string | null>(null);
  const [imagenPreview, setImagenPreview] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleImagenChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setImagen(base64);
        setImagenPreview(base64);
      };
      reader.readAsDataURL(file);
    }
  }

  async function guardar() {
    if (!nombre.trim() || stock < 0 || precio <= 0) return;

    const producto = {
      nombre: nombre.trim(),
      stock,
      precio,
      descripcion: descripcion.trim(),
      categoria,
      imagen,
    };

    setGuardando(true);
    setError(null);
    try {
      await onGuardar(producto);
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el producto");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nuevo producto" onCerrar={onCerrar}>
      <label className="mb-1 block text-xs font-medium">Nombre del producto</label>
      <input
        autoFocus
        type="text"
        placeholder="Nombre"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Descripción (opcional)</label>
      <textarea
        placeholder="Describe el producto..."
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        rows={2}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-2 block text-xs font-medium">Categoría</label>
      <div className="mb-3 flex flex-wrap gap-2">
        {CATEGORIAS_CONSENTIDO.map((cat) => (
          <button
            key={cat.nombre}
            type="button"
            onClick={() => setCategoria(cat.nombre)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              categoria === cat.nombre
                ? "bg-brand-green-600 text-white ring-2 ring-brand-green-400"
                : "border border-brand-vanilla-dark bg-brand-vanilla text-brand-ink hover:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-vanilla"
            }`}
          >
            <span className="text-lg">{cat.logo}</span>
            {cat.nombre}
          </button>
        ))}
      </div>

      <label className="mb-2 block text-xs font-medium">Imagen del producto (opcional)</label>
      {!imagenPreview ? (
        <label className="mb-3 flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-brand-vanilla-dark bg-brand-vanilla/50 p-6 hover:border-brand-green-600 hover:bg-brand-green-50 dark:border-brand-green-700 dark:bg-brand-green-900/20 dark:hover:border-brand-green-500 dark:hover:bg-brand-green-900/40">
          <svg
            className="mb-2 h-8 w-8 text-brand-ink/40 dark:text-brand-vanilla/40"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className="text-xs font-medium text-brand-ink/70 dark:text-brand-vanilla/70">
            Haz clic para subir imagen
          </span>
          <span className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
            PNG, JPG, GIF (máx. 5MB)
          </span>
          <input
            type="file"
            accept="image/*"
            onChange={handleImagenChange}
            className="hidden"
          />
        </label>
      ) : (
        <div className="mb-3 rounded-md bg-brand-green-50 p-4 dark:bg-brand-green-900/30">
          <div className="flex items-start gap-3">
            <img src={imagenPreview} alt="Preview" className="h-20 w-20 rounded object-cover" />
            <div className="flex-1">
              <p className="mb-2 text-xs font-medium text-brand-green-700 dark:text-brand-vanilla">
                Imagen cargada
              </p>
              <button
                type="button"
                onClick={() => {
                  setImagen(null);
                  setImagenPreview(null);
                }}
                className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
              >
                Cambiar imagen
              </button>
            </div>
          </div>
        </div>
      )}

      <label className="mb-1 block text-xs font-medium">Stock inicial</label>
      <input
        type="text"
        inputMode="numeric"
        placeholder="0"
        value={stock || ""}
        onChange={(e) => {
          const val = e.target.value.replace(/\D/g, "");
          setStock(val === "" ? 0 : Number(val));
        }}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Precio unitario</label>
      <MoneyInput
        value={precio}
        onChange={setPrecio}
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || !nombre.trim() || precio <= 0}
        className="w-full rounded-md bg-brand-green-600 px-4 py-3 font-semibold text-white hover:bg-brand-green-700 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar producto"}
      </button>
    </Modal>
  );
}
