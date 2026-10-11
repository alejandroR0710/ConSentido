# Minimizar "Registrar ingreso" en Caja General — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que "Registrar ingreso" en Caja General (botón "+ Ingreso", y "Pasar a factura" desde una cotización) se pueda minimizar — la ✕, el fondo oscuro, y un botón explícito "Minimizar" guardan el formulario completo en vez de perderlo, y se retoma después desde la misma barra combinada que ya existe para las cuentas de Migao.

**Architecture:** `IngresoModal` ya es un `<Modal>` — no hay que convertirlo en uno. A diferencia de Migao, no existe ninguna entidad de backend que repedir al restaurar (todo es estado de React puro hasta el único POST atómico final), así que lo que se guarda es el formulario completo y literal, identificado por un `id` generado en el navegador. Un nuevo Context (`IngresosMinimizadosProvider`), completamente separado del de Migao, guarda ese mapa en `localStorage` (por usuario). `IngresoModal` se encarga sola de guardarse al desmontar (vía un cleanup de `useEffect`, nunca con una llamada explícita antes de cada acción de cierre) — eso cubre a la vez la ✕/backdrop/botón, navegar a otra pantalla sin minimizar, y que otra restauración la reemplace. Una nueva `BarraMinimizados` reemplaza a la barra actual de Migao como el único componente fijo al pie de pantalla, leyendo de los dos Contexts y mezclando los chips.

**Tech Stack:** React 19 + TypeScript 6 + Vite 8, Context API, `localStorage`, `crypto.randomUUID()` (API web estándar, sin dependencia nueva).

**Spec:** `docs/superpowers/specs/2026-10-11-caja-minimizar-ingreso-design.md`

## Global Constraints

- Trabajo directo en `main`, sin worktree; ejecución Native (inline) — ya aprobado por el usuario para toda esta sesión.
- Verificación: `cd frontend && npm run build` (= `tsc -b && vite build`) limpio en cada paso — este repo no tiene framework de tests, igual que en los planes anteriores de esta sesión.
- **100% frontend. Sin migración de base de datos, sin cambios de backend.**
- Alcance: solo `IngresoModal` ("Registrar ingreso"), desde sus dos puntos de entrada (`CajaPage` y `CotizacionesPage`). `EgresoModal`/`EgresoAcumuladoModal` quedan fuera — no se tocan.
- Clave de `localStorage`: `"caja-ingresos-minimizados"`, **por usuario** desde el inicio (`${clave}:${usuario.id}`) — mismo ajuste que ya se le hizo al Context de Migao tras su revisión final, aplicado acá desde el primer commit.
- `IngresosMinimizadosContext` y `BarraMinimizados` son código nuevo y separado; `CuentasMinimizadasContext.tsx` (Migao) **no se modifica** en ningún paso de este plan. `BarraCuentasMinimizadas.tsx` se elimina (reemplazada por `BarraMinimizados`, que la absorbe).
- `tsconfig.app.json` tiene `noUnusedLocals`/`noUnusedParameters` — cualquier import/variable que quede sin uso tras una edición rompe el build.
- `IngresoModal.tsx` tiene hoy un `interface LineaIngreso` local (sin `export`) — este plan la mueve al nuevo archivo de Context (para que el snapshot minimizado y el formulario comparzan un solo tipo, sin import circular) y `IngresoModal` la importa desde ahí.

## Review Focus

- **Restaurar un ingreso que vino de una cotización debe seguir marcándola como facturada al registrar** — sin importar si se restauró en `CajaPage` o en `CotizacionesPage` (solo puede restaurarse en esta última, ver siguiente punto), el `onRegistrado` debe llamar a `migaoApi.marcarCotizacionFacturada` igual que el flujo normal. Cubierto en la Tarea 6 (`onRegistrado` unificado).
- **Un chip de origen `"cotizacion"` debe navegar a `/migao/cotizaciones` al restaurar, uno de origen `"caja"` a `/caja`** — nunca a la pantalla equivocada. Cubierto en la Tarea 2 (`BarraMinimizados`).
- **Abrir "Registrar ingreso" y cerrarlo sin tocar nada no debe dejar un chip fantasma en la barra.** Cubierto en la Tarea 4 (`guardarComoMinimizado` se salta si el formulario sigue intacto).
- **Restaurar un ingreso distinto mientras uno ya está abierto en la misma pantalla debe minimizar el activo primero, nunca perderlo en silencio.** Cubierto en las Tareas 4/5/6 (un `key` basado en el id fuerza que React desmonte la instancia activa al cambiar de snapshot, y el cleanup de desmontaje de la Tarea 4 la guarda sola).
- **Después de registrar exitosamente (pantalla "¿Deseas imprimir?"), cerrar esa pantalla no debe volver a guardar el ingreso ya completado como minimizado.** Cubierto en la Tarea 4 (`guardarComoMinimizado` se salta si `resultado` ya existe).

---

### Task 1: `IngresosMinimizadosContext.tsx` — Context, hook, tipos y persistencia por usuario

**Files:**
- Create: `frontend/src/shared/ingresosMinimizados/IngresosMinimizadosContext.tsx`

**Interfaces:**
- Consumes: `MetodoPagoValor` de `frontend/src/shared/components/SelectorMetodoPago.tsx`; `ModuloOrigenSlug` de `frontend/src/modules/caja/api.ts` (ambos ya existen, sin cambios); `useAuth` de `frontend/src/shared/auth/useAuth.ts`.
- Produces: tipos `LineaIngreso`, `OrigenIngreso`, `FormularioIngreso`, `IngresoMinimizado`; componente `IngresosMinimizadosProvider({ children })`; hook `useIngresosMinimizados()` devolviendo `{ minimizados: IngresoMinimizado[], minimizar(id, origen, etiqueta, montoAproximado, formulario), restaurar(id), descartar(id), pendienteDeRestaurar: IngresoMinimizado | null, limpiarPendienteDeRestaurar() }`. Las Tareas 2, 4, 5 y 6 consumen esto con estos nombres exactos.

- [ ] **Step 1: Crear el archivo completo**

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth/useAuth";
import type { MetodoPagoValor } from "../components/SelectorMetodoPago";
import type { ModuloOrigenSlug } from "../../modules/caja/api";

/** Una línea del "carrito" de Registrar ingreso — mismo shape que
 *  IngresoModal.tsx usaba de forma local; vive acá para que el snapshot
 *  minimizado y el formulario compartan un solo tipo, sin import circular
 *  (IngresoModal importa de este archivo, nunca al revés). */
export interface LineaIngreso {
  key: number;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  // El cajero cambió el precio a mano: el mayorista automático ya no lo toca.
  precioManual?: boolean;
  // Solo queda seteado cuando la línea vino del autocompletar de productos —
  // escribir después de elegir lo limpia, porque el texto ya no coincide
  // necesariamente con el producto del catálogo.
  productoId?: string;
  // Obligatoria si la línea deja el producto en stock negativo.
  observacionInventario?: string;
}

/** De dónde sale este formulario — determina a qué pantalla navega restaurar
 *  y qué pasa después de registrar (ver IngresoModal.tsx/CajaPage.tsx/
 *  CotizacionesPage.tsx). `numeroCotizacion` viaja acá (no solo el id) porque
 *  es lo único que necesita el chip de la barra para su etiqueta. */
export type OrigenIngreso =
  | { tipo: "caja" }
  | { tipo: "cotizacion"; cotizacionId: string; numeroCotizacion: string };

/** El formulario completo y literal de "Registrar ingreso" — a diferencia de
 *  Migao, no hay ninguna entidad de backend que repedir al restaurar (nada se
 *  persiste hasta el único submit final), así que esto es exactamente lo que
 *  hace falta para reabrirlo tal cual (ver spec 2026-10-11). */
export interface FormularioIngreso {
  modulo: ModuloOrigenSlug;
  modoMonto: "unico" | "productos";
  monto: number;
  lineas: LineaIngreso[];
  descuentoPorcentaje: number;
  pago: MetodoPagoValor;
  montoRecibido: number;
  motivo: string;
}

export interface IngresoMinimizado {
  id: string;
  origen: OrigenIngreso;
  etiqueta: string;
  montoAproximado: number;
  minimizadoEn: string;
  formulario: FormularioIngreso;
}

interface IngresosMinimizadosContextValue {
  minimizados: IngresoMinimizado[];
  minimizar: (
    id: string,
    origen: OrigenIngreso,
    etiqueta: string,
    montoAproximado: number,
    formulario: FormularioIngreso,
  ) => void;
  restaurar: (id: string) => void;
  descartar: (id: string) => void;
  pendienteDeRestaurar: IngresoMinimizado | null;
  limpiarPendienteDeRestaurar: () => void;
}

const STORAGE_KEY_BASE = "caja-ingresos-minimizados";

const IngresosMinimizadosContext = createContext<IngresosMinimizadosContextValue | null>(null);

function leerDeLocalStorage(storageKey: string): Record<string, IngresoMinimizado> {
  try {
    const crudo = localStorage.getItem(storageKey);
    return crudo ? (JSON.parse(crudo) as Record<string, IngresoMinimizado>) : {};
  } catch {
    return {};
  }
}

/**
 * Formularios de "Registrar ingreso" minimizados a mitad de llenar — a
 * diferencia de CuentasMinimizadasContext (Migao), no hay ninguna entidad de
 * backend que volver a pedir: nada se persiste hasta el único submit final,
 * así que lo que se guarda es el formulario completo y literal. Mismo patrón
 * de montaje en AppShell.tsx y de persistencia por usuario en localStorage
 * que el Context de Migao.
 */
export function IngresosMinimizadosProvider({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  const storageKey = `${STORAGE_KEY_BASE}:${usuario?.id ?? "anonimo"}`;
  const [mapa, setMapa] = useState<Record<string, IngresoMinimizado>>(() => leerDeLocalStorage(storageKey));
  const [pendienteDeRestaurar, setPendienteDeRestaurar] = useState<IngresoMinimizado | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(mapa));
    } catch {
      // localStorage lleno o bloqueado (modo privado) — sigue funcionando en
      // memoria el resto de la sesión, solo no sobrevive un refresh.
    }
  }, [mapa, storageKey]);

  const minimizar = useCallback(
    (id: string, origen: OrigenIngreso, etiqueta: string, montoAproximado: number, formulario: FormularioIngreso) => {
      setMapa((prev) => ({
        ...prev,
        [id]: { id, origen, etiqueta, montoAproximado, minimizadoEn: new Date().toISOString(), formulario },
      }));
    },
    [],
  );

  const restaurar = useCallback(
    (id: string) => {
      const entry = mapa[id];
      if (!entry) return;
      setPendienteDeRestaurar(entry);
      setMapa((prev) => {
        const { [id]: _restaurado, ...resto } = prev;
        return resto;
      });
    },
    [mapa],
  );

  const descartar = useCallback((id: string) => {
    setMapa((prev) => {
      const { [id]: _descartado, ...resto } = prev;
      return resto;
    });
  }, []);

  const limpiarPendienteDeRestaurar = useCallback(() => setPendienteDeRestaurar(null), []);

  return (
    <IngresosMinimizadosContext.Provider
      value={{
        minimizados: Object.values(mapa),
        minimizar,
        restaurar,
        descartar,
        pendienteDeRestaurar,
        limpiarPendienteDeRestaurar,
      }}
    >
      {children}
    </IngresosMinimizadosContext.Provider>
  );
}

export function useIngresosMinimizados() {
  const ctx = useContext(IngresosMinimizadosContext);
  if (!ctx) throw new Error("useIngresosMinimizados debe usarse dentro de IngresosMinimizadosProvider");
  return ctx;
}
```

- [ ] **Step 2: Verificar compilación**

Run: `cd frontend && npm run build`
Expected: compila sin errores (archivo todavía no importado por nadie).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/shared/ingresosMinimizados/IngresosMinimizadosContext.tsx
git commit -m "feat(caja): agrega IngresosMinimizadosProvider para minimizar Registrar ingreso"
```

---

### Task 2: `BarraMinimizados.tsx` — barra combinada (reemplaza a `BarraCuentasMinimizadas`)

**Files:**
- Create: `frontend/src/shared/layout/BarraMinimizados.tsx`
- Delete: `frontend/src/shared/cuentasMinimizadas/BarraCuentasMinimizadas.tsx` (sus chips de Migao quedan absorbidos en el archivo nuevo)

**Interfaces:**
- Consumes: `useCuentasMinimizadas()` de `frontend/src/shared/cuentasMinimizadas/CuentasMinimizadasContext.tsx` (Migao, sin cambios); `useIngresosMinimizados()` de la Tarea 1; `formatMoney` de `frontend/src/shared/format/money.ts`.
- Produces: componente `BarraMinimizados` (sin props) — la Tarea 3 lo monta en `AppShell.tsx` en vez de `BarraCuentasMinimizadas`.

- [ ] **Step 1: Crear el archivo completo**

```tsx
import { useLocation, useNavigate } from "react-router-dom";
import { formatMoney } from "../format/money";
import { useCuentasMinimizadas } from "../cuentasMinimizadas/CuentasMinimizadasContext";
import { useIngresosMinimizados } from "../ingresosMinimizados/IngresosMinimizadosContext";

/**
 * Barra fija al pie de la pantalla, visible en toda la plataforma — mezcla
 * las cuentas de Migao minimizadas y los formularios de "Registrar ingreso"
 * de Caja General minimizados en una sola lista de chips. Cada Context es
 * independiente (ver CuentasMinimizadasContext.tsx / IngresosMinimizadosContext.tsx);
 * esta barra es el único punto donde se mezclan. Solo existe visualmente si
 * hay algo minimizado de cualquiera de los dos tipos.
 */
export function BarraMinimizados() {
  const { minimizadas: cuentas, restaurar: restaurarCuenta, descartar: descartarCuenta } = useCuentasMinimizadas();
  const { minimizados: ingresos, restaurar: restaurarIngreso, descartar: descartarIngreso } = useIngresosMinimizados();
  const navigate = useNavigate();
  const location = useLocation();

  if (cuentas.length === 0 && ingresos.length === 0) return null;

  function restaurarCuentaDesdeBarra(ordenId: string) {
    if (location.pathname !== "/migao") navigate("/migao");
    restaurarCuenta(ordenId);
  }

  function restaurarIngresoDesdeBarra(id: string, destino: string) {
    if (location.pathname !== destino) navigate(destino);
    restaurarIngreso(id);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 overflow-x-auto border-t border-brand-vanilla-dark bg-brand-vanilla p-2 dark:border-brand-green-700 dark:bg-brand-green-900">
      {cuentas.map((c) => (
        <div
          key={`cuenta-${c.ordenId}`}
          className="flex shrink-0 items-center gap-2 rounded-full border border-brand-green-600 bg-brand-green-50 px-3 py-1.5 text-sm dark:border-brand-green-500 dark:bg-brand-green-700/30"
        >
          <button
            onClick={() => restaurarCuentaDesdeBarra(c.ordenId)}
            className="font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla"
          >
            ➖ {c.etiqueta} · {formatMoney(c.montoAproximado)}
          </button>
          <button
            onClick={() => descartarCuenta(c.ordenId)}
            aria-label={`Descartar ${c.etiqueta} minimizada`}
            title="Descartar sin restaurar"
            className="text-brand-ink/50 hover:text-red-600 dark:text-brand-vanilla/50"
          >
            ✕
          </button>
        </div>
      ))}
      {ingresos.map((i) => (
        <div
          key={`ingreso-${i.id}`}
          className="flex shrink-0 items-center gap-2 rounded-full border border-brand-green-600 bg-brand-green-50 px-3 py-1.5 text-sm dark:border-brand-green-500 dark:bg-brand-green-700/30"
        >
          <button
            onClick={() =>
              restaurarIngresoDesdeBarra(i.id, i.origen.tipo === "cotizacion" ? "/migao/cotizaciones" : "/caja")
            }
            className="font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla"
          >
            ➖ {i.etiqueta} · {formatMoney(i.montoAproximado)}
          </button>
          <button
            onClick={() => descartarIngreso(i.id)}
            aria-label={`Descartar ${i.etiqueta} minimizado`}
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

- [ ] **Step 2: Eliminar `BarraCuentasMinimizadas.tsx`** (sus chips ya quedaron cubiertos arriba; `AppShell.tsx` todavía la importa — eso se corrige en la Tarea 3, así que el build de este paso fallará hasta completarla, ver nota de verificación abajo)

```bash
rm frontend/src/shared/cuentasMinimizadas/BarraCuentasMinimizadas.tsx
```

- [ ] **Step 3: Commit**

No se verifica compilación en este punto — borrar `BarraCuentasMinimizadas.tsx` deja a `AppShell.tsx` con un import roto hasta la Tarea 3 (que lo corrige en el mismo paso en que monta `BarraMinimizados`). Commitear los dos cambios de esta tarea juntos igual es correcto porque ninguno se commiteará solo sin la Tarea 3 — la primera verificación real de este reemplazo es el Step 3 de la Tarea 3.

```bash
git add frontend/src/shared/layout/BarraMinimizados.tsx
git add frontend/src/shared/cuentasMinimizadas/BarraCuentasMinimizadas.tsx
git commit -m "feat(caja): agrega la barra combinada de minimizados (reemplaza la de Migao)"
```

---

### Task 3: Montar `IngresosMinimizadosProvider` y `BarraMinimizados` en `AppShell.tsx`

**Files:**
- Modify: `frontend/src/shared/layout/AppShell.tsx`

**Interfaces:**
- Consumes: `IngresosMinimizadosProvider` de la Tarea 1; `BarraMinimizados` de la Tarea 2.
- Produces: nada nuevo — cablea lo ya producido.

- [ ] **Step 1: Reemplazar el import de la barra vieja y agregar el Provider nuevo**

`old_string`:

```
import { ComponenteAlarmaPedidos } from "../../modules/pedidos/components/ComponenteAlarmaPedidos";
import { BarraCuentasMinimizadas } from "../cuentasMinimizadas/BarraCuentasMinimizadas";
import { CuentasMinimizadasProvider } from "../cuentasMinimizadas/CuentasMinimizadasContext";
import { useAuth } from "../auth/useAuth";
import { tieneAccesoTotal } from "../auth/roles";
import { Modal } from "../components/Modal";
import { BannerNotificaciones } from "../push/BannerNotificaciones";
import { RefrescoProvider, useRefrescoVista } from "../refresh/RefrescoContext";
import { BotonLeadExterno } from "./BotonLeadExterno";
import { IndicadorTurnoCaja } from "./IndicadorTurnoCaja";
import { RoleNav } from "./RoleNav";
```

`new_string`:

```
import { ComponenteAlarmaPedidos } from "../../modules/pedidos/components/ComponenteAlarmaPedidos";
import { CuentasMinimizadasProvider } from "../cuentasMinimizadas/CuentasMinimizadasContext";
import { IngresosMinimizadosProvider } from "../ingresosMinimizados/IngresosMinimizadosContext";
import { useAuth } from "../auth/useAuth";
import { tieneAccesoTotal } from "../auth/roles";
import { Modal } from "../components/Modal";
import { BannerNotificaciones } from "../push/BannerNotificaciones";
import { RefrescoProvider, useRefrescoVista } from "../refresh/RefrescoContext";
import { BarraMinimizados } from "./BarraMinimizados";
import { BotonLeadExterno } from "./BotonLeadExterno";
import { IndicadorTurnoCaja } from "./IndicadorTurnoCaja";
import { RoleNav } from "./RoleNav";
```

- [ ] **Step 2: Anidar el Provider nuevo y montar la barra nueva**

`old_string` (borde de apertura):

```
  return (
    <RefrescoProvider>
      <CuentasMinimizadasProvider>
        {tieneAccesoTotal(usuario.rol) && <ComponenteAlarmaPedidos />}
        <div className="min-h-screen bg-brand-vanilla text-brand-ink dark:bg-brand-green-900 dark:text-brand-vanilla">
```

`new_string`:

```
  return (
    <RefrescoProvider>
      <CuentasMinimizadasProvider>
        <IngresosMinimizadosProvider>
        {tieneAccesoTotal(usuario.rol) && <ComponenteAlarmaPedidos />}
        <div className="min-h-screen bg-brand-vanilla text-brand-ink dark:bg-brand-green-900 dark:text-brand-vanilla">
```

`old_string` (borde de cierre):

```
        )}
        </div>
        <BarraCuentasMinimizadas />
      </CuentasMinimizadasProvider>
    </RefrescoProvider>
  );
}
```

`new_string`:

```
        )}
        </div>
        <BarraMinimizados />
        </IngresosMinimizadosProvider>
      </CuentasMinimizadasProvider>
    </RefrescoProvider>
  );
}
```

- [ ] **Step 3: Verificar compilación**

Run: `cd frontend && npm run build`
Expected: compila sin errores (esta es la primera verificación real desde la Tarea 2 — confirma que borrar `BarraCuentasMinimizadas.tsx` y reemplazarla acá quedó consistente).

- [ ] **Step 4: Verificación manual (usuario, en su entorno)**

Navegar por la app: la barra no debe aparecer en ningún lado (nada minimizado todavía). El resto de AppShell (menú, header) se ve igual que antes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/layout/AppShell.tsx
git commit -m "feat(caja): monta el provider de ingresos y la barra combinada en AppShell"
```

---

### Task 4: `IngresoModal.tsx` — minimizar al desmontar, restaurar desde un snapshot

**Files:**
- Modify: `frontend/src/modules/caja/components/IngresoModal.tsx`

**Interfaces:**
- Consumes: `useIngresosMinimizados`, `type FormularioIngreso`, `type IngresoMinimizado`, `type LineaIngreso`, `type OrigenIngreso` de la Tarea 1 (`../../../shared/ingresosMinimizados/IngresosMinimizadosContext`).
- Produces: `IngresoModalProps` gana `origen: OrigenIngreso` (obligatorio) y `snapshotRestaurado?: IngresoMinimizado` (opcional) — las Tareas 5 y 6 pasan estos props.

**Antes de editar:** releer el archivo real si algún `old_string` no calza exacto — no adivinar.

- [ ] **Step 1: Imports — agregar `useRef` y el import del Context nuevo**

`old_string`:

```
import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { CalculadoraVuelta } from "../../../shared/components/CalculadoraVuelta";
import { Modal } from "../../../shared/components/Modal";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import {
  SelectorMetodoPago,
  faltaReferenciaBanco,
  referenciaBancoPayload,
  type MetodoPagoValor,
} from "../../../shared/components/SelectorMetodoPago";
import { formatMoney } from "../../../shared/format/money";
import { conSentidoApi, type ProductoConSentido } from "../../con_sentido/api";
```

`new_string`:

```
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { CalculadoraVuelta } from "../../../shared/components/CalculadoraVuelta";
import { Modal } from "../../../shared/components/Modal";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import {
  SelectorMetodoPago,
  faltaReferenciaBanco,
  referenciaBancoPayload,
  type MetodoPagoValor,
} from "../../../shared/components/SelectorMetodoPago";
import { formatMoney } from "../../../shared/format/money";
import {
  useIngresosMinimizados,
  type FormularioIngreso,
  type IngresoMinimizado,
  type LineaIngreso,
  type OrigenIngreso,
} from "../../../shared/ingresosMinimizados/IngresosMinimizadosContext";
import { conSentidoApi, type ProductoConSentido } from "../../con_sentido/api";
```

- [ ] **Step 2: Props — agregar `origen`/`snapshotRestaurado`, quitar el `LineaIngreso` local (ya se importa)**

`old_string`:

```
interface IngresoModalProps {
  onCerrar: () => void;
  // Recibe el resultado del registro — quien abre este modal desde otro
  // lugar (ej. "Pasar a factura" de una cotización) lo necesita para, por
  // ejemplo, dejar un rastro de qué venta salió de ahí.
  onRegistrado: (resultado: RegistrarIngresoResultado) => Promise<void>;
  // Precarga el formulario — usado para "Pasar a factura" desde una
  // cotización: todo queda editable, esto solo evita volver a escribirlo.
  valoresIniciales?: {
    moduloOrigenSlug?: ModuloOrigenSlug;
    motivo?: string;
    items?: ItemIngresoInput[];
  };
}

// Igual que en Cotizaciones: en vez de un solo monto, se pueden agregar
// varias líneas sueltas (nombre libre + cantidad + precio) y el total se
// suma solo — útil cuando el ingreso viene de varios productos/servicios
// distintos que no vale la pena registrar como venta aparte.
interface LineaIngreso {
  key: number;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  // El cajero cambió el precio a mano: el mayorista automático ya no lo toca.
  precioManual?: boolean;
  // Solo queda seteado cuando la línea vino del autocompletar de productos
  // (ver SugerenciasProducto) — escribir después de elegir lo limpia, porque
  // el texto ya no coincide necesariamente con el producto del catálogo.
  productoId?: string;
  // Obligatoria si la línea deja el producto en stock negativo (ver faltaStock).
  observacionInventario?: string;
}

let siguienteKeyLinea = 1;
```

`new_string`:

```
interface IngresoModalProps {
  // De dónde sale este formulario — viaja con el snapshot al minimizar para
  // saber a qué pantalla volver y qué hacer después de registrar (ver
  // IngresosMinimizadosContext.tsx).
  origen: OrigenIngreso;
  onCerrar: () => void;
  // Recibe el resultado del registro — quien abre este modal desde otro
  // lugar (ej. "Pasar a factura" de una cotización) lo necesita para, por
  // ejemplo, dejar un rastro de qué venta salió de ahí.
  onRegistrado: (resultado: RegistrarIngresoResultado) => Promise<void>;
  // Precarga el formulario — usado para "Pasar a factura" desde una
  // cotización: todo queda editable, esto solo evita volver a escribirlo.
  valoresIniciales?: {
    moduloOrigenSlug?: ModuloOrigenSlug;
    motivo?: string;
    items?: ItemIngresoInput[];
  };
  // Formulario minimizado que se está restaurando — tiene prioridad sobre
  // valoresIniciales (que solo aplica al abrir en blanco desde una cotización).
  snapshotRestaurado?: IngresoMinimizado;
}

let siguienteKeyLinea = 1;
```

- [ ] **Step 3: Componente — leer `origen`/`snapshotRestaurado`, generar/reusar `id`, sembrar el estado desde el snapshot si hay uno**

`old_string`:

```
export function IngresoModal({ onCerrar, onRegistrado, valoresIniciales }: IngresoModalProps) {
  const tieneItemsIniciales = Boolean(valoresIniciales?.items && valoresIniciales.items.length > 0);
  // Con Sentido por defecto: la mayoría de ingresos manuales acá son de ahí
  // (Migao casi siempre cobra desde su propia pantalla, no desde acá) — antes
  // arrancaba en "migao" y era fácil dejarlo así sin querer.
  const [modulo, setModulo] = useState<ModuloOrigenSlug>(valoresIniciales?.moduloOrigenSlug ?? "con_sentido");
  // "Agregar productos" abre primero (es el flujo más usado); "Monto único"
  // queda como segunda opción para un ingreso suelto sin desglose.
  const [modoMonto, setModoMonto] = useState<"unico" | "productos">("productos");
  // "Monto" siempre es el bruto (antes de descuento); lo que realmente se
  // registra/suma al turno es el neto ya descontado (montoNeto más abajo).
  const [monto, setMonto] = useState(0);
  const [lineas, setLineas] = useState<LineaIngreso[]>(
    tieneItemsIniciales
      ? valoresIniciales!.items!.map((i) => ({ key: siguienteKeyLinea++, ...i }))
      : [lineaVacia()],
  );
  const [descuentoPorcentaje, setDescuentoPorcentaje] = useState(0);
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  const [montoRecibido, setMontoRecibido] = useState(0);
  const [motivo, setMotivo] = useState(valoresIniciales?.motivo ?? "");
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
```

`new_string`:

```
export function IngresoModal({ origen, onCerrar, onRegistrado, valoresIniciales, snapshotRestaurado }: IngresoModalProps) {
  const { minimizar } = useIngresosMinimizados();
  // Mismo id si se está restaurando (para que minimizar de nuevo pise la
  // misma entrada en vez de duplicarla); uno nuevo si el formulario arranca
  // en blanco o precargado desde una cotización.
  const [id] = useState(() => snapshotRestaurado?.id ?? crypto.randomUUID());
  const f = snapshotRestaurado?.formulario;
  const tieneItemsIniciales = Boolean(valoresIniciales?.items && valoresIniciales.items.length > 0);
  // Con Sentido por defecto: la mayoría de ingresos manuales acá son de ahí
  // (Migao casi siempre cobra desde su propia pantalla, no desde acá) — antes
  // arrancaba en "migao" y era fácil dejarlo así sin querer.
  const [modulo, setModulo] = useState<ModuloOrigenSlug>(f?.modulo ?? valoresIniciales?.moduloOrigenSlug ?? "con_sentido");
  // "Agregar productos" abre primero (es el flujo más usado); "Monto único"
  // queda como segunda opción para un ingreso suelto sin desglose.
  const [modoMonto, setModoMonto] = useState<"unico" | "productos">(f?.modoMonto ?? "productos");
  // "Monto" siempre es el bruto (antes de descuento); lo que realmente se
  // registra/suma al turno es el neto ya descontado (montoNeto más abajo).
  const [monto, setMonto] = useState(f?.monto ?? 0);
  const [lineas, setLineas] = useState<LineaIngreso[]>(
    f?.lineas ??
      (tieneItemsIniciales
        ? valoresIniciales!.items!.map((i) => ({ key: siguienteKeyLinea++, ...i }))
        : [lineaVacia()]),
  );
  const [descuentoPorcentaje, setDescuentoPorcentaje] = useState(f?.descuentoPorcentaje ?? 0);
  const [pago, setPago] = useState<MetodoPagoValor>(f?.pago ?? { metodoPago: "efectivo" });
  const [montoRecibido, setMontoRecibido] = useState(f?.montoRecibido ?? 0);
  const [motivo, setMotivo] = useState(f?.motivo ?? valoresIniciales?.motivo ?? "");
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
```

- [ ] **Step 4: Agregar `guardarComoMinimizado` + el cleanup de desmontaje, antes de `registrar()`**

`old_string`:

```
  async function registrar() {
    if (!puedeRegistrar) return;
```

`new_string`:

```
  /** Guarda el formulario tal cual bajo su id — a diferencia de Migao, no hay
   *  nada "fresco" que repedir al backend, así que esto es todo lo que hace
   *  falta para poder restaurarlo después (ver spec 2026-10-11). Se salta si
   *  ya se registró (nada que minimizar) o si el formulario sigue intacto
   *  (abrirlo y cerrarlo sin tocar nada no debe dejar un chip en la barra). */
  function guardarComoMinimizado() {
    if (resultado) return;
    const sinTocar = lineasValidas.length === 0 && monto === 0 && motivo.trim().length === 0;
    if (sinTocar) return;
    const formulario: FormularioIngreso = {
      modulo,
      modoMonto,
      monto,
      lineas,
      descuentoPorcentaje,
      pago,
      montoRecibido,
      motivo,
    };
    const etiqueta = origen.tipo === "cotizacion" ? `Cotización #${origen.numeroCotizacion}` : "Ingreso";
    minimizar(id, origen, etiqueta, montoNeto, formulario);
  }

  // guardarComoMinimizadoRef siempre apunta a la versión más reciente de la
  // función (cierra sobre el estado del último render) — el cleanup de abajo
  // se registra una sola vez (deps vacías) y solo se dispara al desmontar de
  // verdad, así que no puede leer el closure del primer render.
  const guardarComoMinimizadoRef = useRef(guardarComoMinimizado);
  useEffect(() => {
    guardarComoMinimizadoRef.current = guardarComoMinimizado;
  });

  // Minimizar nunca pierde el progreso sin importar POR QUÉ este modal deja
  // de estar montado: la ✕/fondo oscuro/botón "Minimizar" (los tres llaman a
  // onCerrar sin más), otra restauración que lo reemplaza en la misma
  // pantalla (ver key en CajaPage/CotizacionesPage), o navegar a otra
  // pantalla sin tocar nada explícito.
  useEffect(() => {
    return () => guardarComoMinimizadoRef.current();
  }, []);

  async function registrar() {
    if (!puedeRegistrar) return;
```

- [ ] **Step 5: Botón "Minimizar" explícito en el formulario**

`old_string`:

```
  return (
    <Modal titulo="Registrar ingreso" onCerrar={onCerrar} maxWidth="sm:max-w-2xl">
      <label className="mb-2 block text-xs font-medium">Viene de</label>
```

`new_string`:

```
  return (
    <Modal titulo="Registrar ingreso" onCerrar={onCerrar} maxWidth="sm:max-w-2xl">
      <button
        type="button"
        onClick={onCerrar}
        className="mb-2 block text-sm font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla"
      >
        ➖ Minimizar
      </button>

      <label className="mb-2 block text-xs font-medium">Viene de</label>
```

- [ ] **Step 6: Verificar compilación**

Run: `cd frontend && npm run build`
Expected: falla — `IngresoModalProps.origen` ahora es obligatorio y ni `CajaPage.tsx` ni `CotizacionesPage.tsx` lo pasan todavía (eso lo corrigen las Tareas 5 y 6). Confirmar que el error sea exactamente ese (falta la prop `origen` en los dos call sites), no otro.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/caja/components/IngresoModal.tsx
git commit -m "feat(caja): IngresoModal se minimiza solo al desmontar y puede restaurarse desde un snapshot"
```

---

### Task 5: `CajaPage.tsx` — pasar `origen`, detectar y abrir una restauración

**Files:**
- Modify: `frontend/src/modules/caja/pages/CajaPage.tsx`

**Interfaces:**
- Consumes: `useIngresosMinimizados`, `type IngresoMinimizado` de la Tarea 1; `IngresoModal` ya con los props de la Tarea 4.

- [ ] **Step 1: Import**

`old_string`:

```
import { IngresoModal } from "../components/IngresoModal";
```

`new_string`:

```
import { IngresoModal } from "../components/IngresoModal";
import {
  useIngresosMinimizados,
  type IngresoMinimizado,
} from "../../../shared/ingresosMinimizados/IngresosMinimizadosContext";
```

- [ ] **Step 2: Estado nuevo + efecto que detecta una restauración de origen "caja"**

`old_string`:

```
  const [modalAbierto, setModalAbierto] = useState<"ingreso" | "egreso" | "reset" | "administracion" | null>(null);
```

`new_string`:

```
  const [modalAbierto, setModalAbierto] = useState<"ingreso" | "egreso" | "reset" | "administracion" | null>(null);
  const [snapshotIngresoRestaurado, setSnapshotIngresoRestaurado] = useState<IngresoMinimizado | null>(null);
  const { pendienteDeRestaurar, limpiarPendienteDeRestaurar } = useIngresosMinimizados();
  useEffect(() => {
    if (pendienteDeRestaurar?.origen.tipo !== "caja") return;
    setSnapshotIngresoRestaurado(pendienteDeRestaurar);
    setModalAbierto("ingreso");
    limpiarPendienteDeRestaurar();
  }, [pendienteDeRestaurar, limpiarPendienteDeRestaurar]);
```

- [ ] **Step 3: Pasar `origen`/`snapshotRestaurado` al render de `IngresoModal`, limpiar el snapshot al cerrar**

`old_string`:

```
      {modalAbierto === "ingreso" && (
        <IngresoModal onCerrar={() => setModalAbierto(null)} onRegistrado={cargarResumenDeTurnoActual} />
      )}
```

`new_string`:

```
      {modalAbierto === "ingreso" && (
        <IngresoModal
          key={snapshotIngresoRestaurado?.id ?? "nuevo"}
          origen={{ tipo: "caja" }}
          onCerrar={() => {
            setModalAbierto(null);
            setSnapshotIngresoRestaurado(null);
          }}
          onRegistrado={cargarResumenDeTurnoActual}
          snapshotRestaurado={snapshotIngresoRestaurado ?? undefined}
        />
      )}
```

- [ ] **Step 4: Verificar compilación**

Run: `cd frontend && npm run build`
Expected: falla solo por `CotizacionesPage.tsx` (todavía no pasa `origen` — eso lo corrige la Tarea 6); confirmar que ya no hay error sobre `CajaPage.tsx`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/caja/pages/CajaPage.tsx
git commit -m "feat(caja): CajaPage restaura un ingreso minimizado desde la barra"
```

---

### Task 6: `CotizacionesPage.tsx` — pasar `origen`, restaurar, y seguir marcando la cotización como facturada

**Files:**
- Modify: `frontend/src/modules/migao/pages/CotizacionesPage.tsx`

**Interfaces:**
- Consumes: `useIngresosMinimizados`, `type IngresoMinimizado` de la Tarea 1; `IngresoModal` ya con los props de la Tarea 4.

- [ ] **Step 1: Import**

`old_string`:

```
import { IngresoModal } from "../../caja/components/IngresoModal";
```

`new_string`:

```
import { IngresoModal } from "../../caja/components/IngresoModal";
import {
  useIngresosMinimizados,
  type IngresoMinimizado,
} from "../../../shared/ingresosMinimizados/IngresosMinimizadosContext";
```

- [ ] **Step 2: Estado nuevo + efecto que detecta una restauración de origen "cotizacion"**

`old_string`:

```
  const [facturandoCotizacion, setFacturandoCotizacion] = useState<CotizacionDetalle | null>(null);
  const [cargandoFacturar, setCargandoFacturar] = useState<string | null>(null);
  const [errorFacturar, setErrorFacturar] = useState<string | null>(null);
```

`new_string`:

```
  const [facturandoCotizacion, setFacturandoCotizacion] = useState<CotizacionDetalle | null>(null);
  const [cargandoFacturar, setCargandoFacturar] = useState<string | null>(null);
  const [errorFacturar, setErrorFacturar] = useState<string | null>(null);
  const [snapshotIngresoRestaurado, setSnapshotIngresoRestaurado] = useState<IngresoMinimizado | null>(null);
  const { pendienteDeRestaurar, limpiarPendienteDeRestaurar } = useIngresosMinimizados();
  useEffect(() => {
    if (pendienteDeRestaurar?.origen.tipo !== "cotizacion") return;
    setSnapshotIngresoRestaurado(pendienteDeRestaurar);
    limpiarPendienteDeRestaurar();
  }, [pendienteDeRestaurar, limpiarPendienteDeRestaurar]);
```

- [ ] **Step 3: Unificar el render de `IngresoModal` (normal + restaurado) y seguir llamando a `marcarCotizacionFacturada`**

`old_string`:

```
      {facturandoCotizacion && (
        <IngresoModal
          onCerrar={() => setFacturandoCotizacion(null)}
          valoresIniciales={{
            motivo: [
              `Cotización #${facturandoCotizacion.numero}`,
              facturandoCotizacion.cliente_nombre ?? undefined,
              facturandoCotizacion.cliente_telefono ?? undefined,
              facturandoCotizacion.nota ?? undefined,
            ]
              .filter(Boolean)
              .join(" — "),
            items: facturandoCotizacion.items.map((item) => ({
              nombre: item.nombre,
              cantidad: Number(item.cantidad),
              precioUnitario: Number(item.precio_unitario),
            })),
          }}
          onRegistrado={async (resultado) => {
            try {
              await migaoApi.marcarCotizacionFacturada(facturandoCotizacion.id, resultado.venta.id);
            } catch {
              // El ingreso ya quedó registrado — si esto falla, la cotización
              // simplemente no queda marcada como facturada, nada se deshace.
            }
            await cargarCotizaciones();
          }}
        />
      )}
```

`new_string`:

```
      {(facturandoCotizacion || snapshotIngresoRestaurado) && (
        <IngresoModal
          key={snapshotIngresoRestaurado?.id ?? facturandoCotizacion?.id ?? "nuevo"}
          origen={
            facturandoCotizacion
              ? { tipo: "cotizacion", cotizacionId: facturandoCotizacion.id, numeroCotizacion: facturandoCotizacion.numero }
              : snapshotIngresoRestaurado!.origen
          }
          onCerrar={() => {
            setFacturandoCotizacion(null);
            setSnapshotIngresoRestaurado(null);
          }}
          valoresIniciales={
            facturandoCotizacion
              ? {
                  motivo: [
                    `Cotización #${facturandoCotizacion.numero}`,
                    facturandoCotizacion.cliente_nombre ?? undefined,
                    facturandoCotizacion.cliente_telefono ?? undefined,
                    facturandoCotizacion.nota ?? undefined,
                  ]
                    .filter(Boolean)
                    .join(" — "),
                  items: facturandoCotizacion.items.map((item) => ({
                    nombre: item.nombre,
                    cantidad: Number(item.cantidad),
                    precioUnitario: Number(item.precio_unitario),
                  })),
                }
              : undefined
          }
          snapshotRestaurado={snapshotIngresoRestaurado ?? undefined}
          onRegistrado={async (resultado) => {
            const origenActivo = facturandoCotizacion
              ? ({
                  tipo: "cotizacion" as const,
                  cotizacionId: facturandoCotizacion.id,
                  numeroCotizacion: facturandoCotizacion.numero,
                })
              : snapshotIngresoRestaurado!.origen;
            if (origenActivo.tipo === "cotizacion") {
              try {
                await migaoApi.marcarCotizacionFacturada(origenActivo.cotizacionId, resultado.venta.id);
              } catch {
                // El ingreso ya quedó registrado — si esto falla, la cotización
                // simplemente no queda marcada como facturada, nada se deshace.
              }
            }
            await cargarCotizaciones();
          }}
        />
      )}
```

- [ ] **Step 4: Verificar compilación**

Run: `cd frontend && npm run build`
Expected: compila sin errores, 0 warnings de `noUnusedLocals`/`noUnusedParameters` — esta es la primera verificación limpia de todo el plan (las Tareas 4 y 5 quedaron con errores intermedios esperados hasta esta tarea).

- [ ] **Step 5: Verificación manual (usuario, en su entorno)**

1. En `/caja`, click "+ Ingreso", escribir algo (una línea de producto o un motivo), click "➖ Minimizar" → el modal se cierra, aparece un chip "Ingreso" en la barra al pie.
2. Click el chip → se reabre en `/caja` con exactamente lo que se había escrito.
3. Abrir "+ Ingreso" y cerrarlo con la ✕ SIN escribir nada → no debe aparecer ningún chip.
4. Desde Cotizaciones, "Pasar a factura" en alguna cotización, cambiar el método de pago, click en la ✕ del modal (no el botón) → aparece un chip "Cotización #N" en la barra.
5. Navegar a otra pantalla (ej. `/caja`) y click ese chip de cotización → navega de vuelta a `/migao/cotizaciones` y reabre el formulario con lo que se había cambiado.
6. Completar el registro desde ese chip restaurado → confirmar en el historial de cotizaciones que quedó marcada como facturada.
7. Con un ingreso abierto y sin minimizar en `/caja`, click en un chip de OTRO ingreso minimizado → el activo se minimiza solo (aparece su chip) y se abre el otro.
8. Minimizar un ingreso, recargar la página (F5) → el chip sigue en la barra.
9. Registrar un ingreso normalmente hasta la pantalla "¿Deseas imprimir?", cerrarla con "No, gracias" → no debe aparecer ningún chip para ese ingreso ya registrado.
10. Minimizar una cuenta de Migao y un ingreso de Caja General al mismo tiempo → los dos chips se ven juntos en la misma barra, cada uno restaura a su propia pantalla.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/migao/pages/CotizacionesPage.tsx
git commit -m "feat(caja): CotizacionesPage restaura un ingreso minimizado y sigue marcando la cotización facturada"
```

---

## Execution Handoff

Sin migración de base de datos ni cambios de backend — 100% frontend. Verificación en cada paso vía `cd frontend && npm run build`, más los pasos de verificación manual explícitos de las Tareas 3 y 6 que el usuario debe corroborar en su propio navegador.

Dado que ya se aprobó ejecución Native (inline, en esta misma sesión) y trabajo directo en `main`, se recomienda continuar con **superpowers:executing-plans** salvo que el usuario prefiera cambiar de método para este plan puntual.
