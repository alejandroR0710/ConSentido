import { useEffect, useState } from "react";

interface MoneyInputProps {
  value: number;
  onChange: (value: number) => void;
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
}

function formatear(digitos: string) {
  if (!digitos) return "";
  return Number(digitos).toLocaleString("es-CO");
}

/**
 * Input de dinero en pesos enteros (sin centavos) con separador de miles
 * mientras se escribe. Reemplaza a `<input type="number">` para estos campos:
 * ese tipo nativo no permite mostrar puntos de miles (un punto ahí se
 * interpreta como decimal) y, controlado desde React con un `value` numérico,
 * terminaba anteponiendo ceros y dejando de aceptar el teclado — solo
 * funcionaban las flechas nativas de incremento/decremento.
 */
export function MoneyInput({ value, onChange, autoFocus, className, placeholder }: MoneyInputProps) {
  const [texto, setTexto] = useState(value > 0 ? formatear(String(value)) : "");

  // Si el valor cambia desde afuera (ej. se abre el modal con un valor ya cargado
  // para editar), sincroniza el texto mostrado sin pisar lo que el usuario esté
  // escribiendo en ese mismo instante.
  useEffect(() => {
    setTexto(value > 0 ? formatear(String(value)) : value === 0 ? "" : formatear(String(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function manejarCambio(e: React.ChangeEvent<HTMLInputElement>) {
    const soloDigitos = e.target.value.replace(/\D/g, "");
    setTexto(formatear(soloDigitos));
    onChange(soloDigitos ? Number(soloDigitos) : 0);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoFocus={autoFocus}
      value={texto}
      onChange={manejarCambio}
      placeholder={placeholder}
      className={className}
    />
  );
}
