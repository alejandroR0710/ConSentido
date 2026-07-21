import { useEffect, useState } from "react";

interface NumeroInputProps {
  value: number;
  onChange: (value: number) => void;
  /** Permite el signo "-" al principio (para ajustes que pueden restar). */
  permitirNegativo?: boolean;
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
}

/**
 * Input numérico (con decimales) respaldado por texto libre, no por
 * `type="number"` controlado directo — ese patrón, apenas el `value` se
 * "limpia"/clampa en cada tecla (como hacíamos con Math.max en el onChange),
 * termina anteponiendo ceros y dejando de aceptar el teclado, solo
 * funcionan las flechas nativas (mismo problema que ya se había resuelto en
 * MoneyInput.tsx para montos en pesos). Acá se permite además un punto
 * decimal, para cantidades como "0.5" unidades.
 */
export function NumeroInput({
  value,
  onChange,
  permitirNegativo = false,
  autoFocus,
  className,
  placeholder,
}: NumeroInputProps) {
  const [texto, setTexto] = useState(value !== 0 ? String(value) : "");

  // Si el valor cambia desde afuera (ej. se abre el modal con datos ya
  // cargados para editar), sincroniza sin pisar lo que el usuario esté
  // escribiendo en ese mismo instante.
  useEffect(() => {
    setTexto(value !== 0 ? String(value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function manejarCambio(e: React.ChangeEvent<HTMLInputElement>) {
    const patron = permitirNegativo ? /[^0-9.-]/g : /[^0-9.]/g;
    const limpio = e.target.value.replace(patron, "");
    setTexto(limpio);
    const numero = Number(limpio);
    onChange(Number.isNaN(numero) ? 0 : numero);
  }

  return (
    <input
      type="text"
      inputMode={permitirNegativo ? "text" : "decimal"}
      autoFocus={autoFocus}
      value={texto}
      onChange={manejarCambio}
      placeholder={placeholder}
      className={className}
    />
  );
}
