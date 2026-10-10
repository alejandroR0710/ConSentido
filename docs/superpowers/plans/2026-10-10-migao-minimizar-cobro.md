# Minimizar cobro en Migao — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la vista de cobro de Migao (propina, método de pago, abono dividido, pago de ítems sueltos) en un `<Modal>` flotante real que se puede **minimizar** — sin perder ninguna decisión ya tomada — para que el cajero navegue a otra pantalla (pagar otra cuenta, Caja General, etc.) y retome cualquier cuenta minimizada después desde una barra persistente visible en toda la plataforma.

**Architecture:** Un nuevo Context de React (`CuentasMinimizadasProvider` + hook `useCuentasMinimizadas()`), montado en `AppShell.tsx` igual que `RefrescoProvider`, guarda un mapa `ordenId → CuentaMinimizada` sincronizado a `localStorage`. `MigaoPage.tsx` se restructura para que la lista de órdenes se renderice siempre y la vista de cobro se monte como un `<Modal>` encima; su `onCerrar` (✕, backdrop, y un botón explícito) es, literalmente, la función de minimizar. Una nueva `BarraCuentasMinimizadas` (también montada en `AppShell.tsx`) lista las cuentas minimizadas y las restaura. No hay cambios de backend: todo el estado nuevo vive en el navegador.

**Tech Stack:** React 19 + TypeScript 6 + Vite 8, Context API, `localStorage`. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-10-10-migao-minimizar-cobro-design.md`

## Global Constraints

- Trabajo directo en `main`, sin worktree (ya aprobado por el usuario para toda esta sesión).
- Ejecución Native (inline, sin subagentes por tarea) — ya aprobado por el usuario para toda esta sesión.
- Verificación: este repo no tiene framework de tests. El criterio "Expected" de cada paso es `cd frontend && npm run build` (= `tsc -b && vite build`) limpio, 0 errores. Donde el paso no pueda verificarse solo con tsc (comportamiento real en navegador), el paso dice explícitamente qué debe corroborar el usuario en su propio entorno — igual que en los dos planes anteriores de esta sesión.
- **Esta funcionalidad es 100% frontend.** No hay migración de base de datos, no hay cambios de backend, no hay endpoint nuevo. No hay SQL que entregarle al usuario al final de este plan.
- Clave exacta de `localStorage`: `"migao-cuentas-minimizadas"` (decisión explícita de la spec, sección 3).
- `tsconfig.app.json` tiene `noUnusedLocals: true` y `noUnusedParameters: true` — cualquier función/variable que quede sin uso tras una edición (ej. `volverALista` en la Tarea 4) rompe el build y debe eliminarse, no dejarse "por si acaso".
- Los literales válidos de `ordenes.estado` en este sistema son `'abierta' | 'en_preparacion' | 'servida' | 'pagando' | 'cerrada' | 'cancelada'` (confirmado en `database/mysql/schema.sql:810-811`). Solo `'cerrada'` y `'cancelada'` son terminales — cualquier otro valor sigue siendo una cuenta cobrable.

## Review Focus

- **Click directo en la lista sobre una orden ya minimizada.** La lista de órdenes ahora se ve siempre, incluida una que el cajero ya minimizó. Si la selecciona con un click normal (no desde la barra), debe restaurarse con sus decisiones guardadas — nunca arrancar de cero y pisarlas en silencio. Cubierto en la Tarea 4 (`seleccionarOrden` revisa `minimizadas` primero).
- **Restaurar una cuenta cuyos ítems/partes cambiaron mientras estaba minimizada** (un ítem se canceló, una parte de un abono dividido ya se completó desde otro dispositivo). No debe reventar ni aplicar una referencia a algo que ya no existe — esas referencias puntuales se descartan en silencio, el resto de las decisiones (propina, método de pago) se aplican igual. Cubierto en la Tarea 4 (`restaurarDesdeMinimizada` filtra `cantidadesSeleccionadas`/`abonoForms` contra los datos frescos).
- **Restaurar una cuenta que ya se cerró o canceló mientras estaba minimizada.** Debe mostrar un mensaje claro y quitarla de la barra, nunca mostrar como si las decisiones guardadas siguieran aplicando. Cubierto en la Tarea 4.
- **`localStorage` no disponible o que lanza** (modo privado/incógnito, cuota llena, bloqueado por el navegador). No debe romper el Provider — minimizar/restaurar sigue funcionando en memoria durante la sesión, solo no sobrevive un refresh. Cubierto en la Tarea 1 (try/catch en lectura y escritura).
- **Restaurar una cuenta distinta mientras otra sigue activa (sin minimizar) en la página.** Debe minimizar automáticamente la activa primero (con sus propias decisiones del momento) y después abrir la restaurada — nunca perder trabajo en silencio ni bloquear la acción. Cubierto en la Tarea 4 (el `useEffect` que observa `pendienteDeRestaurar`).

---

### Task 1: `CuentasMinimizadasContext.tsx` — Context, hook y persistencia en localStorage

**Files:**
- Create: `frontend/src/shared/cuentasMinimizadas/CuentasMinimizadasContext.tsx`

**Interfaces:**
- Consumes: `MetodoPagoValor` de `frontend/src/shared/components/SelectorMetodoPago.tsx` (ya existe, sin cambios).
- Produces: tipos `DecisionesCobroMigao`, `CuentaMinimizada`, componente `CuentasMinimizadasProvider({ children })`, hook `useCuentasMinimizadas()` devolviendo `{ minimizadas: CuentaMinimizada[], minimizar(ordenId, etiqueta, montoAproximado, decisiones), restaurar(ordenId), descartar(ordenId), pendienteDeRestaurar: CuentaMinimizada | null, limpiarPendienteDeRestaurar() }`. La Tarea 2 (`BarraCuentasMinimizadas`) y la Tarea 4 (`MigaoPage.tsx`) consumen este hook con estos nombres exactos.

- [ ] **Step 1: Crear el archivo completo**

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { MetodoPagoValor } from "../components/SelectorMetodoPago";

/** El subconjunto de estado de MigaoPage.tsx que representa una decisión ya
 *  tomada por el cajero — nunca el detalle/ítems de la cuenta, que siempre se
 *  vuelve a pedir fresco al backend al restaurar (ver spec 2026-10-10). */
export interface DecisionesCobroMigao {
  pago: MetodoPagoValor;
  montoRecibido: number;
  esAdministrativo: boolean;
  descuentoPorcentaje: number;
  propinaPorcentaje: 0 | 5 | 10 | null;
  propinaMontoCustom: number;
  propinaDecidida: boolean;
  propinaMetodoPago: "efectivo" | "banco";
  abonoForms: Record<
    string,
    { pago: MetodoPagoValor; montoPagarAhora: number; propina: number; montoRecibido: number }
  >;
  cantidadesSeleccionadas: Record<number, number>;
  modalPagarItemsAbierto: boolean;
  pagoItems: MetodoPagoValor;
  propinaItemsPorcentaje: 0 | 5 | 10 | null;
  propinaItemsMontoCustom: number;
  montoRecibidoItems: number;
}

export interface CuentaMinimizada {
  ordenId: string;
  etiqueta: string;
  montoAproximado: number;
  minimizadoEn: string;
  decisiones: DecisionesCobroMigao;
}

interface CuentasMinimizadasContextValue {
  minimizadas: CuentaMinimizada[];
  minimizar: (ordenId: string, etiqueta: string, montoAproximado: number, decisiones: DecisionesCobroMigao) => void;
  restaurar: (ordenId: string) => void;
  descartar: (ordenId: string) => void;
  pendienteDeRestaurar: CuentaMinimizada | null;
  limpiarPendienteDeRestaurar: () => void;
}

const STORAGE_KEY = "migao-cuentas-minimizadas";

const CuentasMinimizadasContext = createContext<CuentasMinimizadasContextValue | null>(null);

function leerDeLocalStorage(): Record<string, CuentaMinimizada> {
  try {
    const crudo = localStorage.getItem(STORAGE_KEY);
    return crudo ? (JSON.parse(crudo) as Record<string, CuentaMinimizada>) : {};
  } catch {
    return {};
  }
}

/**
 * Cuentas de Migao minimizadas a mitad de cobro (propina/método de pago ya
 * elegidos) — sobreviven navegar a otra pantalla y un refresh de página (ver
 * AppShell.tsx, mismo patrón que RefrescoProvider). Nunca guarda el detalle ni
 * los ítems de la cuenta, solo las decisiones del cajero.
 */
export function CuentasMinimizadasProvider({ children }: { children: ReactNode }) {
  const [mapa, setMapa] = useState<Record<string, CuentaMinimizada>>(() => leerDeLocalStorage());
  const [pendienteDeRestaurar, setPendienteDeRestaurar] = useState<CuentaMinimizada | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mapa));
    } catch {
      // localStorage lleno o bloqueado (modo privado) — sigue funcionando en
      // memoria el resto de la sesión, solo no sobrevive un refresh.
    }
  }, [mapa]);

  const minimizar = useCallback(
    (ordenId: string, etiqueta: string, montoAproximado: number, decisiones: DecisionesCobroMigao) => {
      setMapa((prev) => ({
        ...prev,
        [ordenId]: { ordenId, etiqueta, montoAproximado, minimizadoEn: new Date().toISOString(), decisiones },
      }));
    },
    [],
  );

  const restaurar = useCallback(
    (ordenId: string) => {
      const entry = mapa[ordenId];
      if (!entry) return;
      setPendienteDeRestaurar(entry);
      setMapa((prev) => {
        const { [ordenId]: _restaurada, ...resto } = prev;
        return resto;
      });
    },
    [mapa],
  );

  const descartar = useCallback((ordenId: string) => {
    setMapa((prev) => {
      const { [ordenId]: _descartada, ...resto } = prev;
      return resto;
    });
  }, []);

  const limpiarPendienteDeRestaurar = useCallback(() => setPendienteDeRestaurar(null), []);

  return (
    <CuentasMinimizadasContext.Provider
      value={{
        minimizadas: Object.values(mapa),
        minimizar,
        restaurar,
        descartar,
        pendienteDeRestaurar,
        limpiarPendienteDeRestaurar,
      }}
    >
      {children}
    </CuentasMinimizadasContext.Provider>
  );
}

export function useCuentasMinimizadas() {
  const ctx = useContext(CuentasMinimizadasContext);
  if (!ctx) throw new Error("useCuentasMinimizadas debe usarse dentro de CuentasMinimizadasProvider");
  return ctx;
}
```

- [ ] **Step 2: Verificar compilación**

Run: `cd frontend && npm run build`
Expected: compila sin errores (este archivo todavía no lo importa nadie, así que solo valida que el propio archivo tipa correctamente).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/shared/cuentasMinimizadas/CuentasMinimizadasContext.tsx
git commit -m "feat(migao): agrega CuentasMinimizadasProvider para minimizar el cobro"
```

---

### Task 2: `BarraCuentasMinimizadas.tsx` — barra visible en toda la app

**Files:**
- Create: `frontend/src/shared/cuentasMinimizadas/BarraCuentasMinimizadas.tsx`

**Interfaces:**
- Consumes: `useCuentasMinimizadas()` y `CuentaMinimizada` de la Tarea 1 (`./CuentasMinimizadasContext`); `formatMoney` de `frontend/src/shared/format/money.ts` (ya existe); `useNavigate`/`useLocation` de `react-router-dom` (ya es dependencia del proyecto).
- Produces: componente `BarraCuentasMinimizadas` (sin props) — la Tarea 3 lo monta en `AppShell.tsx`.

- [ ] **Step 1: Crear el archivo completo**

```tsx
import { useLocation, useNavigate } from "react-router-dom";
import { formatMoney } from "../format/money";
import { useCuentasMinimizadas } from "./CuentasMinimizadasContext";

/**
 * Barra fija al pie de la pantalla, visible en toda la plataforma (no solo en
 * /migao) — ver AppShell.tsx. Solo existe visualmente si hay algo minimizado.
 */
export function BarraCuentasMinimizadas() {
  const { minimizadas, restaurar, descartar } = useCuentasMinimizadas();
  const navigate = useNavigate();
  const location = useLocation();

  if (minimizadas.length === 0) return null;

  function restaurarDesdeBarra(ordenId: string) {
    if (location.pathname !== "/migao") {
      navigate("/migao");
    }
    restaurar(ordenId);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 overflow-x-auto border-t border-brand-vanilla-dark bg-brand-vanilla p-2 dark:border-brand-green-700 dark:bg-brand-green-900">
      {minimizadas.map((c) => (
        <div
          key={c.ordenId}
          className="flex shrink-0 items-center gap-2 rounded-full border border-brand-green-600 bg-brand-green-50 px-3 py-1.5 text-sm dark:border-brand-green-500 dark:bg-brand-green-700/30"
        >
          <button
            onClick={() => restaurarDesdeBarra(c.ordenId)}
            className="font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla"
          >
            ➖ {c.etiqueta} · {formatMoney(c.montoAproximado)}
          </button>
          <button
            onClick={() => descartar(c.ordenId)}
            aria-label={`Descartar ${c.etiqueta} minimizada`}
            title="Descartar sin restaurar"
            className="text-brand-ink/50 hover:text-red-600 dark:text-brand-vanilla/50"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verificar compilación**

Run: `cd frontend && npm run build`
Expected: compila sin errores (todavía no está montado en ningún árbol, pero valida el archivo solo).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/shared/cuentasMinimizadas/BarraCuentasMinimizadas.tsx
git commit -m "feat(migao): agrega la barra de cuentas minimizadas"
```

---

### Task 3: Montar el Provider y la barra en `AppShell.tsx`

**Files:**
- Modify: `frontend/src/shared/layout/AppShell.tsx`

**Interfaces:**
- Consumes: `CuentasMinimizadasProvider` de la Tarea 1, `BarraCuentasMinimizadas` de la Tarea 2.
- Produces: nada nuevo — solo cablea lo ya producido en las dos tareas anteriores dentro del árbol que ya envuelve `<Outlet />`.

- [ ] **Step 1: Agregar los dos imports nuevos**

En `frontend/src/shared/layout/AppShell.tsx`, el bloque de imports actual (líneas 1-12) es:

```tsx
import { useEffect, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { desbloquearAudio } from "../../modules/migao/beep";
import { ComponenteAlarmaPedidos } from "../../modules/pedidos/components/ComponenteAlarmaPedidos";
import { useAuth } from "../auth/useAuth";
import { tieneAccesoTotal } from "../auth/roles";
import { Modal } from "../components/Modal";
import { BannerNotificaciones } from "../push/BannerNotificaciones";
import { RefrescoProvider, useRefrescoVista } from "../refresh/RefrescoContext";
import { BotonLeadExterno } from "./BotonLeadExterno";
import { IndicadorTurnoCaja } from "./IndicadorTurnoCaja";
import { RoleNav } from "./RoleNav";
```

Usa el Edit tool con este `old_string`:

```
import { ComponenteAlarmaPedidos } from "../../modules/pedidos/components/ComponenteAlarmaPedidos";
import { useAuth } from "../auth/useAuth";
```

y este `new_string`:

```
import { ComponenteAlarmaPedidos } from "../../modules/pedidos/components/ComponenteAlarmaPedidos";
import { BarraCuentasMinimizadas } from "../cuentasMinimizadas/BarraCuentasMinimizadas";
import { CuentasMinimizadasProvider } from "../cuentasMinimizadas/CuentasMinimizadasContext";
import { useAuth } from "../auth/useAuth";
```

- [ ] **Step 2: Envolver el árbol con el Provider y montar la barra**

El `return` actual de `AppShell` (líneas 54-128) es:

```tsx
  return (
    <RefrescoProvider>
      {tieneAccesoTotal(usuario.rol) && <ComponenteAlarmaPedidos />}
      <div className="min-h-screen bg-brand-vanilla text-brand-ink dark:bg-brand-green-900 dark:text-brand-vanilla">
        ...
      </div>

      {menuAbierto && (
        <Modal titulo="Menú" onCerrar={() => setMenuAbierto(false)}>
          ...
        </Modal>
      )}
    </RefrescoProvider>
  );
```

Usa el Edit tool con este `old_string` (el borde de apertura, líneas 54-57):

```
  return (
    <RefrescoProvider>
      {tieneAccesoTotal(usuario.rol) && <ComponenteAlarmaPedidos />}
      <div className="min-h-screen bg-brand-vanilla text-brand-ink dark:bg-brand-green-900 dark:text-brand-vanilla">
```

y este `new_string`:

```
  return (
    <RefrescoProvider>
      <CuentasMinimizadasProvider>
        {tieneAccesoTotal(usuario.rol) && <ComponenteAlarmaPedidos />}
        <div className="min-h-screen bg-brand-vanilla text-brand-ink dark:bg-brand-green-900 dark:text-brand-vanilla">
```

Y este `old_string` (el borde de cierre, líneas 116-128 del archivo real):

```
        )}
      </div>
    </RefrescoProvider>
  );
}
```

y como `new_string`:

```
        )}
        </div>
        <BarraCuentasMinimizadas />
      </CuentasMinimizadasProvider>
    </RefrescoProvider>
  );
}
```

(El contenido entre esos dos bordes — header, aside, main con `<Outlet />`, el Modal del menú — no cambia, solo queda un nivel más indentado dentro de `CuentasMinimizadasProvider`; la indentación exacta no es crítica para la compilación.)

- [ ] **Step 3: Verificar compilación**

Run: `cd frontend && npm run build`
Expected: compila sin errores.

- [ ] **Step 4: Verificación manual (usuario, en su entorno)**

Abrir la app en el navegador, iniciar sesión, navegar por cualquier pantalla: no debe aparecer ninguna barra (todavía no hay nada minimizado — `BarraCuentasMinimizadas` devuelve `null` cuando `minimizadas.length === 0`). Confirmar que el resto de la app (menú, header, Caja Migao) se ve exactamente igual que antes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/layout/AppShell.tsx
git commit -m "feat(migao): monta el provider y la barra de cuentas minimizadas en AppShell"
```

---

### Task 4: `MigaoPage.tsx` — el cobro pasa a ser un Modal minimizable

**Files:**
- Modify: `frontend/src/modules/migao/pages/MigaoPage.tsx`

**Interfaces:**
- Consumes: `useCuentasMinimizadas()` y `DecisionesCobroMigao`/`CuentaMinimizada` de la Tarea 1 (`../../../shared/cuentasMinimizadas/CuentasMinimizadasContext`).
- Produces: nada que otra tarea consuma — es la tarea final.

**Antes de editar:** este archivo tiene 1337 líneas; los `old_string` de abajo usan el contenido exacto verificado en este plan (confirmado leyendo el archivo real antes de escribir esta tarea). Si alguna edición falla por no encontrar el `old_string` exacto, el archivo cambió desde que se escribió este plan — releer esa sección antes de reintentar, nunca adivinar.

- [ ] **Step 1: Importar el hook y el tipo nuevos**

`old_string`:

```
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
```

`new_string`:

```
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import {
  useCuentasMinimizadas,
  type CuentaMinimizada,
} from "../../../shared/cuentasMinimizadas/CuentasMinimizadasContext";
```

- [ ] **Step 2: Consumir el hook al tope del componente**

`old_string`:

```
  const { usuario } = useAuth();
  // "Pago administrativo" (no genera ingreso en Caja General) es exclusivo de
  // Root/Super Root — Cajero cobra normal.
  const puedeAdministrativo = tieneAccesoTotal(usuario?.rol);
```

`new_string`:

```
  const { usuario } = useAuth();
  // "Pago administrativo" (no genera ingreso en Caja General) es exclusivo de
  // Root/Super Root — Cajero cobra normal.
  const puedeAdministrativo = tieneAccesoTotal(usuario?.rol);
  const { minimizadas, minimizar, restaurar, pendienteDeRestaurar, limpiarPendienteDeRestaurar } =
    useCuentasMinimizadas();
```

**Nota sobre verificación:** los Steps 1-7 de abajo dejan el archivo en un estado intermedio que NO compila (variables desestructuradas sin usar todavía, referencias a una función que todavía no existe) — eso es esperado dentro de una misma tarea todavía no commiteada. La verificación real de "Expected: compila sin errores" está en el Step 8, después de aplicar los 7 edits.

- [ ] **Step 3: Hacer que `seleccionarOrden` restaure en vez de resetear si la orden ya está minimizada**

`old_string`:

```
  async function seleccionarOrden(ordenId: string) {
    setOrdenSeleccionadaId(ordenId);
    setDetalle(null);
```

`new_string`:

```
  async function seleccionarOrden(ordenId: string) {
    // Si esta orden ya tiene decisiones guardadas de una minimización previa,
    // restaurarla en vez de arrancar de cero y pisarlas en silencio — mismo
    // camino que usa la barra de minimizadas (ver pendienteDeRestaurar).
    if (minimizadas.some((m) => m.ordenId === ordenId)) {
      restaurar(ordenId);
      return;
    }
    setOrdenSeleccionadaId(ordenId);
    setDetalle(null);
```

- [ ] **Step 4: Borrar `volverALista` (queda sin uso tras el Step 6) y agregar `minimizarActual` + `restaurarDesdeMinimizada`**

`old_string`:

```
  function volverALista() {
    setOrdenSeleccionadaId(null);
    setDetalle(null);
    setError(null);
    setMensaje(null);
  }
```

`new_string`:

```
  /** La ✕ del Modal de cobro, el click al fondo oscuro, y el botón explícito
   *  "Minimizar" llaman los tres a esta misma función — minimizar nunca pierde
   *  el progreso ni es una acción destructiva (ver spec 2026-10-10). */
  function minimizarActual() {
    if (!ordenSeleccionadaId) return;
    const etiqueta = ordenActual
      ? `Mesa ${ordenActual.mesa_numero ?? "—"}${ordenActual.nombre ? ` "${ordenActual.nombre}"` : ""}`
      : "Cuenta";
    const montoAproximado = cuenta ? cuenta.partes.reduce((acc, p) => acc + p.pendiente, 0) : (detalle?.total ?? 0);
    minimizar(ordenSeleccionadaId, etiqueta, montoAproximado, {
      pago,
      montoRecibido,
      esAdministrativo,
      descuentoPorcentaje,
      propinaPorcentaje,
      propinaMontoCustom,
      propinaDecidida,
      propinaMetodoPago,
      abonoForms,
      cantidadesSeleccionadas,
      modalPagarItemsAbierto,
      pagoItems,
      propinaItemsPorcentaje,
      propinaItemsMontoCustom,
      montoRecibidoItems,
    });
    setOrdenSeleccionadaId(null);
    setDetalle(null);
    setError(null);
    setMensaje(null);
  }

  /** Reabre una cuenta minimizada: pide la orden FRESCA al backend (nunca usa
   *  detalle/ítems guardados) y encima le aplica las decisiones que sí se
   *  guardaron. Si ya no está abierta, o si la petición falla, se avisa y se
   *  queda en la lista — nunca aplica decisiones sobre una cuenta inválida. */
  async function restaurarDesdeMinimizada(entry: CuentaMinimizada) {
    setOrdenSeleccionadaId(entry.ordenId);
    setDetalle(null);
    setMensaje(null);
    setError(null);
    reiniciarDivision();
    try {
      const detalleData = await migaoApi.obtenerDetalle(entry.ordenId);
      if (detalleData.orden.estado === "cerrada" || detalleData.orden.estado === "cancelada") {
        setOrdenSeleccionadaId(null);
        setError("Esa cuenta minimizada ya no está abierta (se cerró o se canceló) — se quitó de la lista.");
        return;
      }
      setDetalle(detalleData);
      const d = entry.decisiones;
      setPago(d.pago);
      setMontoRecibido(d.montoRecibido);
      setEsAdministrativo(d.esAdministrativo);
      setDescuentoPorcentaje(d.descuentoPorcentaje);
      setPropinaPorcentaje(d.propinaPorcentaje);
      setPropinaMontoCustom(d.propinaMontoCustom);
      setPropinaDecidida(d.propinaDecidida);
      setPropinaMetodoPago(d.propinaMetodoPago);
      setModalPagarItemsAbierto(d.modalPagarItemsAbierto);
      setPagoItems(d.pagoItems);
      setPropinaItemsPorcentaje(d.propinaItemsPorcentaje);
      setPropinaItemsMontoCustom(d.propinaItemsMontoCustom);
      setMontoRecibidoItems(d.montoRecibidoItems);
      const idsVigentes = new Set(detalleData.items.map((i) => i.id));
      setCantidadesSeleccionadas(
        Object.fromEntries(
          Object.entries(d.cantidadesSeleccionadas).filter(([itemId]) => idsVigentes.has(Number(itemId))),
        ),
      );
      if (detalleData.orden.estado === "pagando") {
        try {
          const cuentaData = await migaoApi.obtenerCuenta(entry.ordenId);
          setCuenta(cuentaData);
          const partesVigentes = new Set(cuentaData.partes.map((p) => p.id));
          setAbonoForms(
            Object.fromEntries(Object.entries(d.abonoForms).filter(([parteId]) => partesVigentes.has(parteId))),
          );
        } catch {
          // 'pagando' por productos sueltos (pagarItems) — nada que reabrir acá.
        }
      }
    } catch (err) {
      setOrdenSeleccionadaId(null);
      setError(err instanceof ApiError ? err.message : "No se pudo recuperar esa cuenta minimizada — se quitó de la lista.");
    } finally {
      limpiarPendienteDeRestaurar();
    }
  }

  // Si al restaurar una cuenta ya hay otra activa (sin minimizar) en la
  // página, esa se minimiza automáticamente primero — nunca se pierde trabajo
  // sin avisar ni se bloquea la acción de restaurar.
  useEffect(() => {
    if (!pendienteDeRestaurar) return;
    if (ordenSeleccionadaId && ordenSeleccionadaId !== pendienteDeRestaurar.ordenId) {
      minimizarActual();
    }
    restaurarDesdeMinimizada(pendienteDeRestaurar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendienteDeRestaurar]);
```

- [ ] **Step 5: La lista de órdenes se renderiza siempre (ya no depende de `!mostrarCobro`)**

`old_string`:

```
      {!mostrarCobro ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
```

`new_string`:

```
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
```

- [ ] **Step 6: La vista de cobro pasa a ser un `<Modal>` encima de la lista**

`old_string`:

```
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          <button
            onClick={volverALista}
            className="self-start text-sm font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla"
          >
            ← Volver a órdenes
          </button>

          <h2 className="-mt-2 flex items-center gap-2 text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">
            <span>
              {ordenActual ? `Mesa ${ordenActual.mesa_numero ?? "—"}` : "Cobro"}
              {ordenActual?.mesero_nombre && (
                <span className="ml-2 text-sm font-normal text-brand-ink/60 dark:text-brand-vanilla/60">
                  Mesero: {ordenActual.mesero_nombre}
                </span>
              )}
              {ordenActual?.nombre && (
                <span className="ml-2 text-sm font-semibold italic text-brand-green-700 dark:text-brand-vanilla">
                  "{ordenActual.nombre}"
                </span>
              )}
            </span>
```

`new_string`:

```
      </div>

      {mostrarCobro && (
        <Modal
          titulo={ordenActual ? `Mesa ${ordenActual.mesa_numero ?? "—"}` : "Cobro"}
          onCerrar={minimizarActual}
          maxWidth="sm:max-w-2xl"
        >
        <div className="flex flex-col gap-4">
          <button
            onClick={minimizarActual}
            className="self-start text-sm font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla"
          >
            ➖ Minimizar
          </button>

          <h2 className="-mt-2 flex items-center gap-2 text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">
            <span className="flex flex-wrap items-center gap-2">
              {ordenActual?.mesero_nombre && (
                <span className="text-sm font-normal text-brand-ink/60 dark:text-brand-vanilla/60">
                  Mesero: {ordenActual.mesero_nombre}
                </span>
              )}
              {ordenActual?.nombre && (
                <span className="text-sm font-semibold italic text-brand-green-700 dark:text-brand-vanilla">
                  "{ordenActual.nombre}"
                </span>
              )}
            </span>
```

(Nota: se quitó el texto `{ordenActual ? ... : "Cobro"}` de dentro del `<h2>` porque ahora es el `titulo` del `Modal` — y se cambió el `<span>` que lo envolvía a `flex flex-wrap items-center gap-2` en vez de depender de `ml-2` en cada hijo, porque ya no hay un texto previo del que separarse con margen.)

- [ ] **Step 7: Cerrar el Modal nuevo (el resto de la vista de cobro, líneas intermedias, no cambia)**

`old_string`:

```
                Cancelar orden (cliente ya no quiere pedir)
              </button>
            </>
          )}
        </div>
      )}

      {modalAbierto === "cancelar" && ordenSeleccionadaId && (
```

`new_string`:

```
                Cancelar orden (cliente ya no quiere pedir)
              </button>
            </>
          )}
        </div>
        </Modal>
      )}

      {modalAbierto === "cancelar" && ordenSeleccionadaId && (
```

- [ ] **Step 8: Verificar compilación**

Run: `cd frontend && npm run build`
Expected: compila sin errores, 0 warnings de `noUnusedLocals`/`noUnusedParameters`. Esta es la primera verificación real de la Tarea 4 — cubre los Steps 1 a 7 completos.

- [ ] **Step 9: Verificación manual (usuario, en su entorno)**

En `/migao`, con al menos una mesa con orden abierta:
1. Click en una orden → se abre como ventana flotante con fondo oscuro (ya no es contenido inline de la página).
2. Elegir método de pago y/o propina, luego click en "➖ Minimizar" → la ventana se cierra, la lista de órdenes queda visible, y abajo aparece la barra con un chip de esa cuenta.
3. Repetir con una segunda orden distinta, minimizarla también → la barra muestra las dos.
4. Navegar a Caja General (u otra pantalla) → la barra sigue visible ahí.
5. Click en un chip de la barra desde esa otra pantalla → navega a `/migao` y abre esa cuenta con el método de pago/propina que se había elegido, ya aplicados.
6. Con una cuenta abierta (sin minimizar) en `/migao`, click en el chip de OTRA cuenta minimizada → la activa se minimiza sola (aparece su chip) y se abre la otra.
7. Abrir una cuenta, elegir algo, click en la ✕ del Modal (no el botón "Minimizar") → debe minimizar igual, nunca perder el progreso ni pedir confirmación de "¿seguro que quieres salir?".
8. Lo mismo haciendo click en el fondo oscuro fuera de la ventana.
9. Minimizar una cuenta, recargar la página completa (F5) → el chip sigue apareciendo en la barra.
10. Click en la ✕ pequeña de un chip (no el chip mismo) → desaparece de la barra sin abrir nada.
11. Minimizar una cuenta, y mientras está minimizada, cerrarla/cancelarla desde otra pestaña o dispositivo; luego intentar restaurarla desde la barra → debe mostrar un mensaje de que ya no está disponible y quitarla de la barra.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/modules/migao/pages/MigaoPage.tsx
git commit -m "feat(migao): la vista de cobro es un Modal minimizable, no contenido inline"
```

---

## Execution Handoff

Sin migración de base de datos ni cambios de backend en este plan — es 100% frontend (Context + localStorage). Verificación en cada paso vía `cd frontend && npm run build` (sin framework de tests en este repo, igual que en los dos planes anteriores de esta sesión), más los pasos de verificación manual explícitos de la Tarea 3 y la Tarea 4 que el usuario debe corroborar en su propio navegador.

Dado que ya se aprobó ejecución Native (inline, en esta misma sesión) y trabajo directo en `main` para toda esta sesión, se recomienda continuar con **superpowers:executing-plans** salvo que el usuario prefiera cambiar de método para este plan puntual.
