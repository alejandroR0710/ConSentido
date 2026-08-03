import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { useAuth } from "../../../shared/auth/useAuth";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { migaoApi, type Mesa } from "../api";
import { AREAS_MESA } from "../areas";
import { EditarMesaEditorModal } from "../components/EditarMesaEditorModal";
import { FloorPlanCanvas } from "../components/FloorPlanCanvas";
import { NuevaMesaModal } from "../components/NuevaMesaModal";
import type { MesaConOcupacion } from "../ocupacionMesas";

/** Tamaño inicial estimado según cuántas personas caben en la mesa — mientras
 *  más grande la capacidad, más grande el rectángulo de arranque (Root igual
 *  puede arrastrarla/redimensionarla después). En % del plano de su área. */
function estimarTamanoMesa(capacidad: number): { ancho: number; alto: number } {
  if (capacidad <= 2) return { ancho: 10, alto: 8 };
  if (capacidad <= 4) return { ancho: 14, alto: 11 };
  if (capacidad <= 6) return { ancho: 18, alto: 13 };
  if (capacidad <= 8) return { ancho: 22, alto: 15 };
  return { ancho: 26, alto: 18 };
}

/** Editor del plano visual de mesas por área — exclusivo de Root/Super Root
 *  (migao.mesas.administrar). Mesero/Cajero solo ven/usan el plano, nunca lo
 *  editan (ver FloorPlanCanvas modo="seleccionar"/"ver"). */
export function EditorMesasPage() {
  const { usuario } = useAuth();
  const puedeEditar = tieneAccesoTotal(usuario?.rol);

  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [piso, setPiso] = useState<1 | 2 | 3>(1);
  const [mostrarInactivas, setMostrarInactivas] = useState(false);
  const [creandoMesa, setCreandoMesa] = useState(false);
  const [mesaEditando, setMesaEditando] = useState<Mesa | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    try {
      setMesas(await migaoApi.listarMesas());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las mesas");
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  if (!puedeEditar) {
    return <Navigate to="/migao" replace />;
  }

  const mesasDelArea = mesas.filter((m) => m.piso === piso && (mostrarInactivas || m.activo));
  // El editor no necesita ocupación real (mover/redimensionar no la usa),
  // pero FloorPlanCanvas espera el shape MesaConOcupacion.
  const mesasParaPlano: MesaConOcupacion[] = mesasDelArea.map((m) => ({ ...m, ordenes: [] }));

  async function crearMesa(numero: string, capacidad: number) {
    // Apila mesas nuevas en diagonal para que no queden todas exactamente
    // superpuestas al crear varias seguidas — Root las reacomoda arrastrando.
    const offset = (mesasDelArea.length % 5) * 8;
    const { ancho, alto } = estimarTamanoMesa(capacidad);
    await migaoApi.crearMesa({
      numero,
      piso,
      capacidad,
      posX: 5 + offset,
      posY: 5 + offset,
      ancho,
      alto,
    });
    await cargar();
  }

  // Postgres NUMERIC vuelve como texto (ver Mesa en api.ts) — Number(...) antes
  // de reenviarlo, si no el backend lo rechaza (espera number, no string).
  async function moverMesa(mesaId: number, posX: number, posY: number) {
    const mesa = mesas.find((m) => m.id === mesaId);
    if (!mesa) return;
    await migaoApi.moverMesa(mesaId, { posX, posY, ancho: Number(mesa.ancho), alto: Number(mesa.alto) });
    await cargar();
  }

  async function redimensionarMesa(mesaId: number, ancho: number, alto: number) {
    const mesa = mesas.find((m) => m.id === mesaId);
    if (!mesa) return;
    await migaoApi.moverMesa(mesaId, { posX: Number(mesa.pos_x), posY: Number(mesa.pos_y), ancho, alto });
    await cargar();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/migao" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Editor de mesas</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Dibuja la ubicación y tamaño de cada mesa — arrastra para moverla, usa la esquina inferior derecha para
          redimensionarla, y toca (sin arrastrar) para editar su número o capacidad.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {AREAS_MESA.map((a) => (
            <button
              key={a.valor}
              onClick={() => setPiso(a.valor)}
              className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-semibold ${
                piso === a.valor
                  ? "border-brand-green-600 bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                  : "border-brand-vanilla-dark text-brand-ink hover:border-brand-green-400 dark:border-brand-green-700 dark:text-brand-vanilla"
              }`}
            >
              <span aria-hidden>{a.icon}</span> {a.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            <input
              type="checkbox"
              checked={mostrarInactivas}
              onChange={(e) => setMostrarInactivas(e.target.checked)}
            />
            Mostrar inactivas
          </label>
          <button
            type="button"
            onClick={() => setCreandoMesa(true)}
            className="rounded-md border-2 border-brand-green-700 px-3 py-1.5 text-sm font-semibold text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/30"
          >
            + Nueva mesa
          </button>
        </div>
      </div>

      <FloorPlanCanvas
        mesas={mesasParaPlano}
        modo="editor"
        onMover={moverMesa}
        onRedimensionar={redimensionarMesa}
        onEditarDetalle={(mesa) => setMesaEditando(mesa)}
      />

      {creandoMesa && <NuevaMesaModal onCerrar={() => setCreandoMesa(false)} onGuardar={crearMesa} />}

      {mesaEditando && (
        <EditarMesaEditorModal
          mesa={mesaEditando}
          onCerrar={() => setMesaEditando(null)}
          onGuardar={async (input) => {
            await migaoApi.editarMesa(mesaEditando.id, input);
            await cargar();
          }}
          onEliminar={async () => {
            await migaoApi.eliminarMesa(mesaEditando.id);
            await cargar();
          }}
          onCambiarActivo={async (activo) => {
            await migaoApi.editarMesa(mesaEditando.id, { activo });
            await cargar();
          }}
        />
      )}
    </div>
  );
}
